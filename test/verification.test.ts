import type { Sandbox } from "@flue/runtime";
import * as v from "valibot";
import { describe, expect, it } from "vitest";
import { readStructuredReview } from "../src/review/publish.ts";
import type { ReviewResult } from "../src/review/schema.ts";
import {
	applyLineReplacement,
	type CargoMetadata,
	type CargoPackage,
	createVerificationCheckoutCommand,
	createVerificationCommand,
	findOwningPackage,
	sha256,
	verifySuggestion,
	verifySuggestionInputSchema,
} from "../src/review/verification.ts";

const repositoryRoot = "/workspace/verification/repository";
const servicePackage: CargoPackage = {
	features: { default: [], stable: [], testing: [] },
	id: "path+file:///workspace/verification/repository/crates/biome_service#0.0.0",
	manifest_path: `${repositoryRoot}/crates/biome_service/Cargo.toml`,
	name: "biome_service",
	targets: [
		{ kind: ["lib"], name: "biome_service" },
		{ kind: ["test"], name: "workspace" },
	],
};

const metadata: CargoMetadata = {
	packages: [
		servicePackage,
		{
			features: {},
			id: "path+file:///workspace/verification/repository/crates/biome_parser#0.0.0",
			manifest_path: `${repositoryRoot}/crates/biome_parser/Cargo.toml`,
			name: "biome_parser",
			targets: [{ kind: ["lib"], name: "biome_parser" }],
		},
	],
	workspace_members: [
		"path+file:///workspace/verification/repository/crates/biome_service#0.0.0",
		"path+file:///workspace/verification/repository/crates/biome_parser#0.0.0",
	],
};

const policy = {
	commandTimeoutMs: 30_000,
	requiredFeatures: { biome_service: ["stable"] },
	rustToolchain: "1.98.1",
};

describe("suggestion verification", () => {
	it("derives the owning workspace package from the suggestion path", () => {
		expect(
			findOwningPackage(
				metadata,
				"crates/biome_service/src/workspace/server.rs",
			)?.name,
		).toBe("biome_service");
		expect(findOwningPackage(metadata, "Cargo.toml")).toBeUndefined();
		expect(
			findOwningPackage(metadata, "crates/not-a-member/src/lib.rs"),
		).toBeUndefined();
	});

	it("adds required package features to focused Clippy", () => {
		const command = createVerificationCommand({
			cargoPackage: servicePackage,
			command: { features: [], kind: "clippy" },
			policy,
		});
		expect(command).toBe(
			"cargo clippy --locked --offline -p 'biome_service' --features 'stable' --no-deps -- -D warnings",
		);
		expect(command).not.toContain("--workspace");
		expect(command).not.toContain("--all-features");
	});

	it("allows declared explicit features and known test targets", () => {
		expect(
			createVerificationCommand({
				cargoPackage: servicePackage,
				command: {
					features: ["testing"],
					filter: "workspace::tests",
					kind: "test",
					target: "workspace",
				},
				policy,
			}),
		).toBe(
			"cargo test --locked --offline -p 'biome_service' --features 'stable,testing' --test 'workspace' 'workspace::tests' -- --show-output",
		);
	});

	it("rejects blanket or undeclared features and unknown targets", () => {
		expect(() =>
			createVerificationCommand({
				cargoPackage: servicePackage,
				command: { features: ["all-features"], kind: "check" },
				policy,
			}),
		).toThrow("Cargo feature all-features is not allowed");
		expect(() =>
			createVerificationCommand({
				cargoPackage: servicePackage,
				command: { features: ["unknown"], kind: "check" },
				policy,
			}),
		).toThrow("does not declare feature unknown");
		expect(() =>
			createVerificationCommand({
				cargoPackage: servicePackage,
				command: {
					features: [],
					filter: null,
					kind: "test",
					target: "missing",
				},
				policy,
			}),
		).toThrow("has no test target named missing");
	});

	it("rejects a test filter that could be parsed as a Cargo option", () => {
		const result = v.safeParse(verifySuggestionInputSchema, {
			command: {
				features: [],
				filter: "--workspace",
				kind: "test",
				target: null,
			},
			endLine: null,
			line: 1,
			path: "crates/biome_service/src/lib.rs",
			replacement: "fixed",
		});
		expect(result.success).toBe(false);
	});

	it("applies multiline and deletion replacements without adding a blank line", () => {
		expect(applyLineReplacement("one\ntwo\n", 1, 2, "first\nsecond")).toBe(
			"first\nsecond\n",
		);
		expect(applyLineReplacement("only\n", 1, null, "")).toBe("");
	});

	it("prepares only the requested public head and locked dependencies", () => {
		const command = createVerificationCheckoutCommand({
			policy,
			pull: {
				headSha: "b".repeat(40),
				pullNumber: 123,
				repository: "biomejs/biome",
			},
		});
		expect(command).toContain("refs/pull/123/head");
		expect(command).toContain("cargo fetch --locked");
		expect(command).toContain("cargo metadata --locked --offline --no-deps");
		expect(command).toContain("RUSTUP_TOOLCHAIN='1.98.1'");
		expect(command).not.toContain("GITHUB_TOKEN");
	});

	it("applies and verifies a suggestion in the isolated checkout", async () => {
		const files = new Map<string, string>([
			["/workspace/verification/.prepared", "b".repeat(40)],
			["/workspace/verification/cargo-metadata.json", JSON.stringify(metadata)],
			[`${repositoryRoot}/crates/biome_service/src/lib.rs`, "fn old() {}\n"],
		]);
		const commands: string[] = [];
		const sandbox = {
			async exec(command: string) {
				commands.push(command);
				return { exitCode: 0, stderr: "", stdout: "passed" };
			},
			async exists(path: string) {
				return files.has(path);
			},
			async readFile(path: string) {
				const content = files.get(path);
				if (content === undefined) throw new Error(`Missing ${path}`);
				return content;
			},
			async writeFile(path: string, content: string | Uint8Array) {
				files.set(path, String(content));
			},
		} as unknown as Sandbox;
		const allowedHosts: string[][] = [];
		const result = await verifySuggestion({
			network: {
				async destroy() {},
				async setAllowedHosts(hosts) {
					allowedHosts.push(hosts);
				},
			},
			policy,
			pull: {
				headSha: "b".repeat(40),
				pullNumber: 123,
				repository: "biomejs/biome",
			},
			receiptId: "tool-1",
			request: {
				command: { features: [], kind: "check" },
				endLine: null,
				line: 1,
				path: "crates/biome_service/src/lib.rs",
				replacement: "fn fixed() {}",
			},
			sandbox,
		});

		expect(result.verified).toBe(true);
		expect(result.receipt).toMatchObject({
			id: "tool-1",
			packageName: "biome_service",
		});
		expect(files.get(`${repositoryRoot}/crates/biome_service/src/lib.rs`)).toBe(
			"fn fixed() {}\n",
		);
		expect(commands.at(-1)).toContain(
			"cargo check --locked --offline -p 'biome_service' --features 'stable'",
		);
		expect(commands.at(-1)).not.toContain("rm -f");
		expect(allowedHosts).toEqual([[]]);
	});

	it("keeps only suggestions backed by an exact successful receipt", async () => {
		const replacement = "return emptyValue;";
		const review: ReviewResult = {
			findings: [
				{
					area: "correctness",
					body: "Empty input returns the wrong value.",
					endLine: null,
					line: 11,
					path: "crates/biome_service/src/lib.rs",
					severity: "high",
					suggestion: { replacement, verificationId: "tool-1" },
					title: "Empty input is mishandled",
				},
			],
			questions: [],
			status: {
				branchTarget: "main",
				brief: "independent",
				changeset: "not required",
				fetch: "updated",
				scope: "one file",
			},
			summary: "",
		};
		const receipt = {
			command: "cargo check -p biome_service --features stable",
			durationMs: 10,
			endLine: null,
			id: "tool-1",
			line: 11,
			packageName: "biome_service",
			path: "crates/biome_service/src/lib.rs",
			replacementSha256: await sha256(replacement),
		};

		await expect(
			readStructuredReview({
				review: [review],
				suggestionVerification: [receipt],
			}),
		).resolves.toEqual(review);
		await expect(
			readStructuredReview({
				review: [review],
				suggestionVerification: [{ ...receipt, line: 12 }],
			}),
		).resolves.toMatchObject({ findings: [{ suggestion: null }] });
	});
});
