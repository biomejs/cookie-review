import type { Finding, ReviewResult } from "./schema.ts";

export function renderFinding(finding: Finding) {
	const sections = [
		`**${finding.severity}/${finding.area}: ${finding.title}**`,
		finding.body,
	];
	if (finding.suggestion !== null) {
		sections.push(renderSuggestion(finding.suggestion.replacement));
	}
	return sections.join("\n\n");
}

export function renderSuggestion(replacement: string) {
	const longestRun = Math.max(
		0,
		...[...replacement.matchAll(/`+/g)].map((match) => match[0].length),
	);
	const fence = "`".repeat(Math.max(3, longestRun + 1));
	return `${fence}suggestion\n${replacement}${replacement.length === 0 ? "" : "\n"}${fence}`;
}

export function renderReviewBody(input: {
	deliveryId: string;
	inlineCount: number;
	review: ReviewResult;
	suggestionCount: number;
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
		input.suggestionCount === 0
			? "- Validation: No verified suggested changes were published; findings may be based on static review."
			: `- Validation: Static review plus isolated, package-scoped verification for ${input.suggestionCount} suggested change${input.suggestionCount === 1 ? "" : "s"}; no whole-workspace command was run.`,
		`- Fetch: ${input.review.status.fetch}`,
	);

	return sections.join("\n\n");
}
