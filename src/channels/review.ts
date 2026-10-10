import { createGitHubChannel } from "@flue/github";
import {
	isConfiguredIssueTriageRequest,
	isConfiguredReviewRequest,
} from "../github/policy.ts";
import type { ReviewRequest } from "../review/request.ts";
import type { IssueTriageRequest } from "../triage/request.ts";

interface Queue<Message> {
	send(message: Message): Promise<unknown>;
}

export function createReviewChannel(input: {
	queue: Queue<ReviewRequest>;
	triageQueue: Queue<IssueTriageRequest>;
	webhookSecret: string;
}) {
	return createGitHubChannel({
		webhookSecret: input.webhookSecret,
		async webhook({ delivery }) {
			if (delivery.name === "issues" && delivery.payload.action === "opened") {
				const { issue, repository } = delivery.payload;
				if (
					!isConfiguredIssueTriageRequest({
						authorAssociation: issue.author_association,
						repository: repository.full_name,
					})
				) {
					return;
				}

				await input.triageQueue.send({
					deliveryId: delivery.deliveryId,
					issueNumber: issue.number,
					repository: repository.full_name,
				});
				return;
			}

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
