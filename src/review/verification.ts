import type { Sandbox as CloudflareSandbox } from "@cloudflare/sandbox";
import type { Sandbox } from "@flue/runtime";
import * as v from "valibot";
import { shellQuote } from "./checkout.ts";
import { isSafeRepositoryPath } from "./diff.ts";

const SHA_PATTERN = /^[0-9a-f]{40}$/;
const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const FEATURE_PATTERN = /^[A-Za-z0-9_-]+$/;
const TARGET_PATTERN = /^[A-Za-z0-9_-]+$/;
const VERIFICATION_ROOT = "/workspace/verification";
const REPOSITORY_ROOT = `${VERIFICATION_ROOT}/repository`;
const METADATA_PATH = `${VERIFICATION_ROOT}/cargo-metadata.json`;
const MARKER_PATH = `${VERIFICATION_ROOT}/.prepared`;
const OUTPUT_PATH = `${VERIFICATION_ROOT}/command-output.log`;
const CARGO_HOME = `${VERIFICATION_ROOT}/cargo-home`;
const CARGO_TARGET_DIR = `${VERIFICATION_ROOT}/target`;
const CARGO_PATH =
	"/usr/local/cargo/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";

export const VERIFICATION_SETUP_HOSTS = [
	"github.com",
	"index.crates.io",
	"static.crates.io",
] as const;

const featureSchema = v.pipe(
	v.string(),
	v.minLength(1),
	v.maxLength(100),
	v.regex(FEATURE_PATTERN, "Feature must be a package-local Cargo feature"),
);
const featuresSchema = v.optional(
	v.pipe(v.array(featureSchema), v.maxLength(20)),
	[],
);

const checkCommandSchema = v.object({
	features: featuresSchema,
	kind: v.literal("check"),
});

const clippyCommandSchema = v.object({
	features: featuresSchema,
	kind: v.literal("clippy"),
});

const testCommandSchema = v.object({
	features: featuresSchema,
	filter: v.optional(
		v.nullable(
			v.pipe(
				v.string(),
				v.minLength(1),
				v.maxLength(200),
				v.check(
					(filter) => !filter.startsWith("-"),
					"Test filter must not be a Cargo option",
				),
			),
		),
		null,
	),
	kind: v.literal("test"),
	target: v.optional(
		v.nullable(
			v.pipe(
				v.string(),
				v.minLength(1),
				v.maxLength(100),
				v.regex(TARGET_PATTERN, "Invalid Cargo test target"),
			),
		),
		null,
	),
});

export const verificationCommandSchema = v.variant("kind", [
	checkCommandSchema,
	testCommandSchema,
	clippyCommandSchema,
]);

export const verificationSuggestionSchema = v.pipe(
	v.object({
		endLine: v.nullable(v.pipe(v.number(), v.integer(), v.minValue(1))),
		line: v.pipe(v.number(), v.integer(), v.minValue(1)),
		path: v.pipe(v.string(), v.minLength(1), v.maxLength(1_000)),
		replacement: v.pipe(
			v.string(),
			v.maxLength(5_000),
			v.check(
				(replacement) =>
					!replacement.includes("\r") && !replacement.endsWith("\n"),
				"Replacement must use LF line endings without a trailing newline",
			),
		),
	}),
	v.check(
		(suggestion) =>
			suggestion.endLine === null || suggestion.endLine >= suggestion.line,
		"Suggestion endLine must not precede line",
	),
);

export const verifySuggestionsInputSchema = v.object({
	command: verificationCommandSchema,
	suggestions: v.pipe(
		v.array(verificationSuggestionSchema),
		v.minLength(1),
		v.maxLength(20),
	),
});

export const suggestionVerificationSchema = v.object({
	command: v.pipe(v.string(), v.minLength(1), v.maxLength(1_000)),
	durationMs: v.pipe(v.number(), v.integer(), v.minValue(0)),
	endLine: v.nullable(v.pipe(v.number(), v.integer(), v.minValue(1))),
	id: v.pipe(v.string(), v.minLength(1), v.maxLength(300)),
	line: v.pipe(v.number(), v.integer(), v.minValue(1)),
	packageName: v.pipe(v.string(), v.minLength(1), v.maxLength(200)),
	path: v.pipe(v.string(), v.minLength(1), v.maxLength(1_000)),
	replacementSha256: v.pipe(
		v.string(),
		v.regex(/^[0-9a-f]{64}$/, "Invalid SHA-256 digest"),
	),
});

export type VerificationCommand = v.InferOutput<
	typeof verificationCommandSchema
>;
export type VerificationSuggestion = v.InferOutput<
	typeof verificationSuggestionSchema
>;
export type VerifySuggestionsInput = v.InferOutput<
	typeof verifySuggestionsInputSchema
>;
export type SuggestionVerification = v.InferOutput<
	typeof suggestionVerificationSchema
>;

interface VerificationPolicy {
	commandTimeoutMs: number;
	requiredFeatures: Readonly<Record<string, readonly string[]>>;
	rustToolchain: string;
}

export interface CargoMetadata {
	packages: CargoPackage[];
	workspace_members: string[];
}

export interface CargoPackage {
	features: Record<string, string[]>;
	id: string;
	manifest_path: string;
	name: string;
	targets: Array<{ kind: string[]; name: string }>;
}

interface PullForVerification {
	headSha: string;
	pullNumber: number;
	repository: string;
}

interface VerificationNetwork {
	destroy(): Promise<void>;
	setAllowedHosts(hosts: string[]): Promise<void>;
}

export interface VerificationResult {
	command: string;
	exitCode: number;
	output: string;
	receipts: SuggestionVerification[];
	verified: boolean;
}

export async function verifySuggestions(input: {
	request: VerifySuggestionsInput;
	policy: VerificationPolicy;
	pull: PullForVerification;
	receiptId: string;
	sandbox: Sandbox;
	network: VerificationNetwork;
	signal?: AbortSignal;
}): Promise<VerificationResult> {
	const { request } = input;
	for (const suggestion of request.suggestions) {
		if (!isSafeRepositoryPath(suggestion.path)) {
			throw new Error("Suggestion path must be repository-relative");
		}
	}

	await ensureVerificationWorkspace(input);
	await resetVerificationWorkspace(
		input.sandbox,
		input.pull.headSha,
		input.signal,
	);

	const metadata = await readCargoMetadata(input.sandbox);
	let cargoPackage: CargoPackage | undefined;
	for (const suggestion of request.suggestions) {
		const owner = findOwningPackage(metadata, suggestion.path);
		if (!owner) {
			throw new Error(
				`No workspace Cargo package owns ${suggestion.path}; publish the finding without a suggestion.`,
			);
		}
		if (cargoPackage && cargoPackage.id !== owner.id) {
			throw new Error(
				"A verification batch must contain suggestions from exactly one Cargo package",
			);
		}
		cargoPackage = owner;
	}
	if (!cargoPackage) throw new Error("Verification batch is empty");

	const command = createVerificationCommand({
		cargoPackage,
		command: request.command,
		policy: input.policy,
	});
	const applicationOrder = orderSuggestionsForApplication(request.suggestions);
	for (const suggestion of applicationOrder) {
		await applySuggestion(input.sandbox, suggestion);
	}

	const diffCheck = await input.sandbox.exec("git diff --check", {
		cwd: REPOSITORY_ROOT,
		signal: input.signal,
		timeoutMs: 30_000,
	});
	if (diffCheck.exitCode !== 0) {
		return {
			command,
			exitCode: diffCheck.exitCode,
			output: truncateOutput(`${diffCheck.stdout}\n${diffCheck.stderr}`),
			receipts: [],
			verified: false,
		};
	}

	const startedAt = Date.now();
	const timeoutSeconds = Math.max(
		1,
		Math.floor(input.policy.commandTimeoutMs / 1_000),
	);
	// Sandbox 0.x executes one shell string. Every dynamic value below is either
	// host-generated or shell-quoted, and the redirection truncates this fixed log
	// path before Cargo starts, so no separate file-removal command is needed.
	const runCommand = [
		"set +e",
		[
			"timeout --signal=TERM --kill-after=5s",
			`${timeoutSeconds}s`,
			"env -i",
			`PATH=${shellQuote(CARGO_PATH)}`,
			`HOME=${shellQuote(VERIFICATION_ROOT)}`,
			`CARGO_HOME=${shellQuote(CARGO_HOME)}`,
			`CARGO_TARGET_DIR=${shellQuote(CARGO_TARGET_DIR)}`,
			"CARGO_NET_OFFLINE=true",
			"CARGO_INCREMENTAL=0",
			"CARGO_PROFILE_TEST_DEBUG=0",
			"CARGO_BUILD_JOBS=4",
			`RUSTUP_TOOLCHAIN=${shellQuote(input.policy.rustToolchain)}`,
			command,
			`> ${shellQuote(OUTPUT_PATH)} 2>&1`,
		].join(" "),
		"status=$?",
		`tail -c 50000 ${shellQuote(OUTPUT_PATH)} 2>/dev/null || true`,
		'exit "$status"',
	].join("\n");

	try {
		const result = await input.sandbox.exec(runCommand, {
			cwd: REPOSITORY_ROOT,
			signal: input.signal,
			timeoutMs: input.policy.commandTimeoutMs + 30_000,
		});
		const output = truncateOutput(`${result.stdout}\n${result.stderr}`);
		if (result.exitCode !== 0) {
			if (result.exitCode === 124) {
				await input.network.destroy().catch(() => undefined);
			}
			return {
				command,
				exitCode: result.exitCode,
				output,
				receipts: [],
				verified: false,
			};
		}
		const durationMs = Date.now() - startedAt;
		const receipts = await Promise.all(
			request.suggestions.map(async (suggestion, index) => ({
				command,
				durationMs,
				endLine: suggestion.endLine,
				id: `${input.receiptId}:${index}`,
				line: suggestion.line,
				packageName: cargoPackage.name,
				path: suggestion.path,
				replacementSha256: await sha256(suggestion.replacement),
			})),
		);

		return {
			command,
			exitCode: 0,
			output,
			receipts,
			verified: true,
		};
	} catch (error) {
		await input.network.destroy().catch(() => undefined);
		throw error;
	}
}

export function createVerificationCheckoutCommand(input: {
	policy: VerificationPolicy;
	pull: PullForVerification;
}) {
	if (
		!SHA_PATTERN.test(input.pull.headSha) ||
		!Number.isInteger(input.pull.pullNumber) ||
		input.pull.pullNumber < 1 ||
		!REPOSITORY_PATTERN.test(input.pull.repository)
	) {
		throw new Error("Invalid pull request verification metadata");
	}

	const repositoryUrl = `https://github.com/${input.pull.repository}.git`;
	const pullRef = `refs/pull/${input.pull.pullNumber}/head`;
	const cargoEnvironment = [
		`PATH=${shellQuote(CARGO_PATH)}`,
		`HOME=${shellQuote(VERIFICATION_ROOT)}`,
		`CARGO_HOME=${shellQuote(CARGO_HOME)}`,
		`RUSTUP_TOOLCHAIN=${shellQuote(input.policy.rustToolchain)}`,
	].join(" ");

	return [
		"set -eu",
		`rm -rf ${shellQuote(VERIFICATION_ROOT)}`,
		`mkdir -p ${shellQuote(VERIFICATION_ROOT)} ${shellQuote(CARGO_HOME)} ${shellQuote(CARGO_TARGET_DIR)}`,
		`git clone --filter=blob:none --no-checkout ${shellQuote(repositoryUrl)} ${shellQuote(REPOSITORY_ROOT)}`,
		`git -C ${shellQuote(REPOSITORY_ROOT)} fetch --no-tags origin ${shellQuote(pullRef)}`,
		`git -C ${shellQuote(REPOSITORY_ROOT)} checkout --detach ${shellQuote(input.pull.headSha)}`,
		`${cargoEnvironment} cargo fetch --locked --manifest-path ${shellQuote(`${REPOSITORY_ROOT}/Cargo.toml`)}`,
		`${cargoEnvironment} CARGO_NET_OFFLINE=true cargo metadata --locked --offline --no-deps --format-version 1 --manifest-path ${shellQuote(`${REPOSITORY_ROOT}/Cargo.toml`)} > ${shellQuote(METADATA_PATH)}`,
		`printf %s ${shellQuote(input.pull.headSha)} > ${shellQuote(MARKER_PATH)}`,
	].join("\n");
}

async function ensureVerificationWorkspace(input: {
	policy: VerificationPolicy;
	pull: PullForVerification;
	sandbox: Sandbox;
	network: VerificationNetwork;
	signal?: AbortSignal;
}) {
	if (await input.sandbox.exists(MARKER_PATH)) {
		await input.network.setAllowedHosts([]);
		return;
	}

	await input.network.setAllowedHosts([...VERIFICATION_SETUP_HOSTS]);
	try {
		const result = await input.sandbox.exec(
			createVerificationCheckoutCommand(input),
			{ signal: input.signal, timeoutMs: 10 * 60 * 1000 },
		);
		if (result.exitCode !== 0) {
			throw new Error(
				`Verification workspace setup failed: ${truncateOutput(`${result.stdout}\n${result.stderr}`)}`,
			);
		}
		await input.network.setAllowedHosts([]);
	} catch (error) {
		await input.network.setAllowedHosts([]).catch(() => undefined);
		await input.network.destroy().catch(() => undefined);
		throw error;
	}
}

async function resetVerificationWorkspace(
	sandbox: Sandbox,
	headSha: string,
	signal?: AbortSignal,
) {
	const result = await sandbox.exec(
		[
			"set -eu",
			`git reset --hard ${shellQuote(headSha)}`,
			"git clean -ffdx",
		].join("\n"),
		{ cwd: REPOSITORY_ROOT, signal, timeoutMs: 60_000 },
	);
	if (result.exitCode !== 0) {
		throw new Error(
			`Could not reset verification checkout: ${truncateOutput(`${result.stdout}\n${result.stderr}`)}`,
		);
	}
}

async function readCargoMetadata(sandbox: Sandbox): Promise<CargoMetadata> {
	const content = await sandbox.readFile(METADATA_PATH);
	if (content.length > 1_000_000)
		throw new Error("Cargo metadata is too large");
	const value: unknown = JSON.parse(content);
	if (!isCargoMetadata(value))
		throw new Error("Cargo returned invalid metadata");
	return value;
}

function isCargoMetadata(value: unknown): value is CargoMetadata {
	if (!value || typeof value !== "object") return false;
	const metadata = value as Partial<CargoMetadata>;
	return (
		Array.isArray(metadata.workspace_members) &&
		metadata.workspace_members.every((member) => typeof member === "string") &&
		Array.isArray(metadata.packages) &&
		metadata.packages.every(
			(pkg) =>
				pkg &&
				typeof pkg === "object" &&
				typeof pkg.id === "string" &&
				typeof pkg.name === "string" &&
				typeof pkg.manifest_path === "string" &&
				pkg.features &&
				typeof pkg.features === "object" &&
				Array.isArray(pkg.targets),
		)
	);
}

export function findOwningPackage(
	metadata: CargoMetadata,
	path: string,
): CargoPackage | undefined {
	if (!isSafeRepositoryPath(path)) return undefined;
	const absolutePath = `${REPOSITORY_ROOT}/${path}`;
	const members = new Set(metadata.workspace_members);
	return metadata.packages
		.filter((pkg) => members.has(pkg.id))
		.filter((pkg) => {
			const directory = pkg.manifest_path.slice(0, -"/Cargo.toml".length);
			return (
				absolutePath === directory || absolutePath.startsWith(`${directory}/`)
			);
		})
		.sort(
			(left, right) => right.manifest_path.length - left.manifest_path.length,
		)
		.at(0);
}

export function createVerificationCommand(input: {
	cargoPackage: CargoPackage;
	command: VerificationCommand;
	policy: VerificationPolicy;
}) {
	const requested = input.command.features;
	const forbidden = requested.find(
		(feature) => feature === "all" || feature === "all-features",
	);
	if (forbidden) throw new Error(`Cargo feature ${forbidden} is not allowed`);

	const required = input.policy.requiredFeatures[input.cargoPackage.name] ?? [];
	const features = [...new Set([...required, ...requested])].sort();
	for (const feature of features) {
		if (!(feature in input.cargoPackage.features)) {
			throw new Error(
				`Cargo package ${input.cargoPackage.name} does not declare feature ${feature}`,
			);
		}
	}

	const args = [
		"cargo",
		input.command.kind,
		"--locked",
		"--offline",
		"-p",
		shellQuote(input.cargoPackage.name),
	];
	if (features.length > 0) {
		args.push("--features", shellQuote(features.join(",")));
	}

	if (input.command.kind === "test") {
		const targetName = input.command.target;
		if (targetName !== null) {
			const isTestTarget = input.cargoPackage.targets.some(
				(target) => target.name === targetName && target.kind.includes("test"),
			);
			if (!isTestTarget) {
				throw new Error(
					`Cargo package ${input.cargoPackage.name} has no test target named ${targetName}`,
				);
			}
			args.push("--test", shellQuote(targetName));
		}
		if (input.command.filter !== null) {
			args.push(shellQuote(input.command.filter));
		}
		args.push("--", "--show-output");
	} else if (input.command.kind === "clippy") {
		args.push("--no-deps", "--", "-D", "warnings");
	}

	return args.join(" ");
}

async function applySuggestion(
	sandbox: Sandbox,
	request: VerificationSuggestion,
) {
	const absolutePath = `${REPOSITORY_ROOT}/${request.path}`;
	const content = await sandbox.readFile(absolutePath);
	await sandbox.writeFile(
		absolutePath,
		applyLineReplacement(
			content,
			request.line,
			request.endLine,
			request.replacement,
		),
	);
}

export function orderSuggestionsForApplication(
	suggestions: VerificationSuggestion[],
) {
	const byPath = new Map<string, VerificationSuggestion[]>();
	for (const suggestion of suggestions) {
		const entries = byPath.get(suggestion.path) ?? [];
		entries.push(suggestion);
		byPath.set(suggestion.path, entries);
	}

	const ordered: VerificationSuggestion[] = [];
	for (const [path, entries] of byPath) {
		entries.sort((left, right) => left.line - right.line);
		for (let index = 1; index < entries.length; index += 1) {
			const previous = entries[index - 1];
			const current = entries[index];
			if (!previous || !current) continue;
			if (current.line <= (previous.endLine ?? previous.line)) {
				throw new Error(`Suggestion ranges overlap in ${path}`);
			}
		}
		ordered.push(...entries.reverse());
	}
	return ordered;
}

export function applyLineReplacement(
	content: string,
	line: number,
	endLine: number | null,
	replacement: string,
) {
	const newline = content.includes("\r\n") ? "\r\n" : "\n";
	const hasFinalNewline = content.endsWith(newline);
	const lines = content.split(/\r?\n/);
	if (hasFinalNewline) lines.pop();
	const resolvedEndLine = endLine ?? line;
	if (resolvedEndLine < line) {
		throw new Error("Suggestion endLine must not precede line");
	}
	if (resolvedEndLine > lines.length) {
		throw new Error(
			`Suggestion range ${line}-${resolvedEndLine} exceeds file contents`,
		);
	}
	const replacementLines =
		replacement.length === 0 ? [] : replacement.split("\n");
	lines.splice(line - 1, resolvedEndLine - line + 1, ...replacementLines);
	return `${lines.join(newline)}${hasFinalNewline && lines.length > 0 ? newline : ""}`;
}

export async function sha256(value: string) {
	const digest = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(value),
	);
	return [...new Uint8Array(digest)]
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("");
}

function truncateOutput(output: string) {
	const trimmed = output.trim();
	return trimmed.length <= 50_000 ? trimmed : trimmed.slice(-50_000);
}

export type VerificationSandboxStub = CloudflareSandbox & VerificationNetwork;
