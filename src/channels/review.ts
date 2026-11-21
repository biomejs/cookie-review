import { createGitHubChannel } from "@flue/github";
import {
	isConfiguredIssueTriageRequest,
	isConfiguredReviewRequest,
	isReproductionUpdate,
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
					event: "opened",
					issueNumber: issue.number,
					repository: repository.full_name,
				});
				return;
			}

			if (delivery.name === "issues" && delivery.payload.action === "edited") {
				const { changes, issue, repository } = delivery.payload;
				if (
					changes.body === undefined ||
					!isReproductionUpdate({
						authorAssociation: issue.author_association,
						labels: labelNames(issue.labels),
						repository: repository.full_name,
					})
				) {
					return;
				}

				await input.triageQueue.send({
					deliveryId: delivery.deliveryId,
					event: "edited",
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
				issue.pull_request === undefined &&
				isReproductionUpdate({
					authorAssociation: comment.author_association,
					labels: labelNames(issue.labels),
					repository: repository.full_name,
				})
			) {
				await input.triageQueue.send({
					commentId: comment.id,
					deliveryId: delivery.deliveryId,
					event: "commented",
					issueNumber: issue.number,
					repository: repository.full_name,
				});
				return;
			}

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

function labelNames(labels: readonly { name: string }[] | undefined) {
	return labels?.map((label) => label.name) ?? [];
}
