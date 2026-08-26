import { Sandbox } from "@cloudflare/sandbox";
import type { Octokit } from "@octokit/rest";
import * as v from "valibot";
import { config } from "./config.ts";
import { ReviewCoordinator } from "./coordinator.ts";
import { createGitHubClient, getErrorStatus } from "./github/client.ts";
import { processReviewRequest } from "./queue.ts";
import { type ReviewRequest, reviewRequestSchema } from "./review/request.ts";
import {
	coordinatorName,
	ReviewWorkflow,
	splitRepository,
} from "./workflows/review.ts";

export { ReviewCoordinator, ReviewWorkflow, Sandbox };

interface WorkerEnv {
	GITHUB_TOKEN: string;
	REVIEW_COORDINATOR: DurableObjectNamespace<ReviewCoordinator>;
}

type GitHubClient = InstanceType<typeof Octokit>;

export default {
	async queue(batch: MessageBatch<ReviewRequest>, env: WorkerEnv) {
		const client = createGitHubClient(env.GITHUB_TOKEN);
		await Promise.all(
			batch.messages.map(async (message) => {
				const parsed = v.safeParse(reviewRequestSchema, message.body);
				if (!parsed.success) {
					console.error("Discarding invalid review request", parsed.issues);
					message.ack();
					return;
				}

				try {
					await processReviewRequest(parsed.output, {
						admit(request) {
							return env.REVIEW_COORDINATOR.getByName(
								coordinatorName(request),
							).admit(request);
						},
						getPermission: (request) => getPermission(client, request),
						reactBusy: (request) => reactBusy(client, request),
					});
					message.ack();
				} catch (error) {
					console.error("Review request processing failed", error);
					message.retry({ delaySeconds: 30 });
				}
			}),
		);
	},
} satisfies ExportedHandler<WorkerEnv, ReviewRequest>;

async function getPermission(client: GitHubClient, request: ReviewRequest) {
	const [owner, repo] = splitRepository(request.repository);
	try {
		const response = await client.rest.repos.getCollaboratorPermissionLevel({
			owner,
			repo,
			username: request.sender,
		});
		return response.data.permission;
	} catch (error) {
		if (getErrorStatus(error) === 404) return undefined;
		throw error;
	}
}

async function reactBusy(client: GitHubClient, request: ReviewRequest) {
	const [owner, repo] = splitRepository(request.repository);
	await client.rest.reactions.createForIssueComment({
		comment_id: request.commentId,
		content: config.busyReaction,
		owner,
		repo,
	});
}
