import type { Finding, ReviewResult } from "./schema.ts";

export function renderFinding(finding: Finding) {
	return `**${finding.severity}/${finding.area}: ${finding.title}**\n\n${finding.body}`;
}

export function renderReviewBody(input: {
	deliveryId: string;
	inlineCount: number;
	remaining: Finding[];
	review: ReviewResult;
}) {
	const sections = [
		`<!-- cookie-review:${input.deliveryId} -->`,
		"## Review Summary",
		input.review.summary || "Review complete.",
		"## Findings",
	];

	if (input.review.findings.length === 0) {
		sections.push("No findings.");
	} else {
		if (input.inlineCount > 0) {
			sections.push(
				`${input.inlineCount} finding${input.inlineCount === 1 ? " was" : "s were"} added inline.`,
			);
		}
		for (const finding of input.remaining) {
			const location =
				finding.line === null
					? finding.path
					: `${finding.path}:${finding.line}${finding.endLine === null ? "" : `-${finding.endLine}`}`;
			sections.push(
				`- \`${finding.severity}/${finding.area}\` \`${location}\` - **${finding.title}.** ${finding.body}`,
			);
		}
	}

	if (input.review.questions.length > 0) {
		sections.push(
			"## Questions",
			...input.review.questions.map((question) => `- ${question}`),
		);
	}

	sections.push(
		"## Review Status",
		`- Scope: ${input.review.status.scope}`,
		`- Branch target: ${input.review.status.branchTarget}`,
		`- Changeset: ${input.review.status.changeset}`,
		`- Brief: ${input.review.status.brief}`,
		"- Validation: Static review only; no project code was run.",
		`- Fetch: ${input.review.status.fetch}`,
	);

	return sections.join("\n\n");
}
