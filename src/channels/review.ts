import { createGitHubChannel } from "@flue/github";
import { isConfiguredReviewRequest } from "../github/policy.ts";
import type { ReviewRequest } from "../review/request.ts";

interface ReviewQueue {
	send(message: ReviewRequest): Promise<unknown>;
}

export function createReviewChannel(input: {
	queue: ReviewQueue;
	webhookSecret: string;
}) {
	return createGitHubChannel({
		webhookSecret: input.webhookSecret,
		async webhook({ delivery }) {
			if (
				delivery.name !== "issue_comment" ||
				delivery.payload.action !== "created"
			) {
				return;
			}

			const { comment, issue, repository, sender } = delivery.payload;
			if (
				!isConfiguredReviewRequest({
					commentBody: comment.body,
					isPullRequest: issue.pull_request !== undefined,
					repository: repository.full_name,
				})
			) {
				return;
			}

			await input.queue.send({
				commentId: comment.id,
				deliveryId: delivery.deliveryId,
				pullNumber: issue.number,
				repository: repository.full_name,
				sender: sender.login,
			});
		},
	});
}
