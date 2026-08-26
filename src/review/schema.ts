import * as v from "valibot";

export const severitySchema = v.picklist(["high", "medium", "low", "optional"]);

export const areaSchema = v.picklist([
	"design",
	"correctness",
	"security",
	"privacy",
	"availability",
	"performance",
	"completeness",
	"error-handling",
	"tests",
	"maintainability",
	"documentation",
	"changeset",
	"process",
]);

const lineSchema = v.pipe(v.number(), v.integer(), v.minValue(1));
const pathSchema = v.pipe(
	v.string(),
	v.minLength(1),
	v.check(
		(path) =>
			!path.startsWith("/") &&
			!path.includes("\\") &&
			!path
				.split("/")
				.some((part) => part === "" || part === "." || part === ".."),
		"Path must be a safe repository-relative path",
	),
);

export const findingSchema = v.pipe(
	v.object({
		area: areaSchema,
		body: v.pipe(v.string(), v.minLength(1), v.maxLength(5_000)),
		endLine: v.nullable(lineSchema),
		line: v.nullable(lineSchema),
		path: pathSchema,
		severity: severitySchema,
		title: v.pipe(v.string(), v.minLength(1), v.maxLength(200)),
	}),
	v.check(
		(finding) => finding.endLine === null || finding.line !== null,
		"endLine requires line",
	),
	v.check(
		(finding) =>
			finding.endLine === null ||
			finding.line === null ||
			finding.endLine >= finding.line,
		"endLine must not precede line",
	),
);

export const reviewResultSchema = v.object({
	findings: v.pipe(v.array(findingSchema), v.maxLength(50)),
	questions: v.pipe(
		v.array(v.pipe(v.string(), v.minLength(1), v.maxLength(2_000))),
		v.maxLength(20),
	),
	status: v.object({
		branchTarget: v.string(),
		brief: v.string(),
		changeset: v.string(),
		fetch: v.string(),
		scope: v.string(),
	}),
	summary: v.pipe(v.string(), v.maxLength(10_000)),
});

export type Finding = v.InferOutput<typeof findingSchema>;
export type ReviewResult = v.InferOutput<typeof reviewResultSchema>;
