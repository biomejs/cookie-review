import type { Octokit } from "@octokit/rest";
import * as v from "valibot";
import { locateFindings } from "./diff.ts";
import { renderFinding, renderReviewBody } from "./render.ts";
import { type ReviewResult, reviewResultSchema } from "./schema.ts";

type GitHubClient = InstanceType<typeof Octokit>;

export function readStructuredReview(data: Record<string, unknown[]>) {
	const writes = data.review;
	if (!writes || writes.length === 0) {
		throw new Error("Reviewer did not emit structured review data");
	}
	return v.parse(reviewResultSchema, writes.at(-1));
}

export function prepareReviewPublication(input: {
	deliveryId: string;
	diffsByPath: ReadonlyMap<string, string>;
	review: ReviewResult;
}) {
	const located = locateFindings(input.review.findings, input.diffsByPath);
	return {
		body: renderReviewBody({
			deliveryId: input.deliveryId,
			inlineCount: located.inline.length,
			remaining: located.remaining,
			review: input.review,
		}),
		comments: located.inline.map((finding) => ({
			body: renderFinding(finding),
			line: finding.endLine ?? (finding.line as number),
			path: finding.path,
			side: "RIGHT" as const,
			...(finding.endLine !== null && finding.line !== finding.endLine
				? { start_line: finding.line as number, start_side: "RIGHT" as const }
				: {}),
		})),
	};
}

export async function publishReview(input: {
	client: GitHubClient;
	commitId: string;
	deliveryId: string;
	diffsByPath: ReadonlyMap<string, string>;
	owner: string;
	pullNumber: number;
	repo: string;
	review: ReviewResult;
}) {
	const publication = prepareReviewPublication(input);
	return publishPreparedReview({ ...input, publication });
}

export async function publishPreparedReview(input: {
	client: GitHubClient;
	commitId: string;
	deliveryId: string;
	owner: string;
	publication: ReturnType<typeof prepareReviewPublication>;
	pullNumber: number;
	repo: string;
}) {
	const marker = `<!-- cookie-review:${input.deliveryId} -->`;
	const reviews = await input.client.paginate(
		input.client.rest.pulls.listReviews,
		{
			owner: input.owner,
			per_page: 100,
			pull_number: input.pullNumber,
			repo: input.repo,
		},
	);
	const existing = reviews.find((review) => review.body.includes(marker));
	if (existing) return { reviewId: existing.id, existing: true };

	const result = await input.client.rest.pulls.createReview({
		body: input.publication.body,
		comments: input.publication.comments,
		commit_id: input.commitId,
		event: "COMMENT",
		owner: input.owner,
		pull_number: input.pullNumber,
		repo: input.repo,
	});

	return { reviewId: result.data.id, existing: false };
}
