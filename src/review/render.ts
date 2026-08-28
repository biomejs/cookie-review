import type { Finding, ReviewResult } from "./schema.ts";

export function renderFinding(finding: Finding) {
	return `**${finding.severity}/${finding.area}: ${finding.title}**\n\n${finding.body}`;
}

export function renderReviewBody(input: {
	deliveryId: string;
	inlineCount: number;
	review: ReviewResult;
}) {
	const sections = [
		`<!-- cookie-review:${input.deliveryId} -->`,
		"## Review Summary",
		input.inlineCount === 0
			? "Review complete. No findings."
			: `Review complete. ${input.inlineCount} finding${input.inlineCount === 1 ? " was" : "s were"} added inline.`,
	];

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
