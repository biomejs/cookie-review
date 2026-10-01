import {
	WorkflowEntrypoint,
	type WorkflowEvent,
	type WorkflowStep,
} from "cloudflare:workers";
import { NonRetryableError } from "cloudflare:workflows";
import { getSandbox, type Sandbox } from "@cloudflare/sandbox";
import { AgentRunError, init } from "@flue/runtime";
import * as v from "valibot";
import { Reviewer } from "../agents/reviewer.ts";
import { config, getRepositoryConfig } from "../config.ts";
import type { ReviewCoordinator } from "../coordinator.ts";
import { createGitHubClient } from "../github/client.ts";
import { readBusinessRequirements } from "../github/context.ts";
import {
	agentRunFailureMessage,
	createAgentRunFailureRecord,
	serializeError,
} from "../observability.ts";
import {
	ensureReviewWorkspace,
	type PullRequestSnapshot,
	shellQuote,
	skillNameFromPath,
} from "../review/checkout.ts";
import { isSafeRepositoryPath } from "../review/diff.ts";
import {
	prepareReviewPublication,
	publishPreparedReview,
	readStructuredReview,
} from "../review/publish.ts";
import { type ReviewRequest, reviewRequestSchema } from "../review/request.ts";

interface ReviewWorkflowEnv {
	GITHUB_TOKEN: string;
	REVIEW_COORDINATOR: DurableObjectNamespace<ReviewCoordinator>;
	Sandbox: DurableObjectNamespace<Sandbox>;
}

export class ReviewWorkflow extends WorkflowEntrypoint<
	ReviewWorkflowEnv,
	ReviewRequest
> {
	async run(event: WorkflowEvent<ReviewRequest>, step: WorkflowStep) {
		const request = v.parse(reviewRequestSchema, event.payload);
		const coordinator = this.env.REVIEW_COORDINATOR.getByName(
			coordinatorName(request),
		);

		try {
			const repository = getRepositoryConfig(request.repository);
			if (!repository)
				throw new NonRetryableError("Repository is not configured");

			const [owner, repo] = splitRepository(request.repository);
			const pull = await step.do("read pull request", async () => {
				const client = createGitHubClient(this.env.GITHUB_TOKEN);
				const response = await client.rest.pulls.get({
					owner,
					pull_number: request.pullNumber,
					repo,
				});
				if (response.data.state !== "open") {
					throw new NonRetryableError("Pull request is not open");
				}
				const body = response.data.body ?? "";
				return {
					baseRef: response.data.base.ref,
					baseSha: response.data.base.sha,
					body,
					headSha: response.data.head.sha,
					pullNumber: request.pullNumber,
					repository: request.repository,
					requirements: await readBusinessRequirements({
						client,
						owner,
						pullBody: body,
						pullNumber: request.pullNumber,
						repo,
					}),
					title: response.data.title,
				} satisfies PullRequestSnapshot;
			});

			await step.do(
				"prepare trusted checkout",
				{
					retries: { backoff: "exponential", delay: "10 seconds", limit: 3 },
					timeout: "15 minutes",
				},
				async () => {
					const sandbox = getSandbox(this.env.Sandbox, event.instanceId, {
						sleepAfter: config.sandboxSleepAfter,
					});
					await ensureReviewWorkspace({
						pull,
						sandbox,
						skillPath: repository.skill,
					});
					return { prepared: true };
				},
			);

			const reviewer = init(Reviewer, { id: event.instanceId });
			const receipt = await step.do("dispatch review", () =>
				reviewer.dispatch({
					initialData: {
						...pull,
						skillName: skillNameFromPath(repository.skill),
					},
					message: {
						kind: "signal",
						type: "github.pull-request.review-requested",
						body: `Review pull request #${request.pullNumber}.`,
						attributes: {
							deliveryId: request.deliveryId,
							repository: request.repository,
						},
					},
					idempotencyKey: request.deliveryId,
				}),
			);

			const review = await step.do(
				"read review",
				{
					retries: { backoff: "exponential", delay: "10 seconds", limit: 5 },
					timeout: "90 minutes",
				},
				async () => {
					const result = await reviewer
						.read(receipt)
						.catch((error: unknown) => {
							if (!(error instanceof AgentRunError)) throw error;
							console.error(
								createAgentRunFailureRecord(error, {
									pullNumber: request.pullNumber,
									repository: request.repository,
									workflowInstanceId: event.instanceId,
								}),
							);
							throw new NonRetryableError(agentRunFailureMessage(error));
						});

					try {
						return readStructuredReview(result.data);
					} catch (error) {
						console.error({
							error: serializeError(error),
							event: "review.result.invalid",
							pullNumber: request.pullNumber,
							repository: request.repository,
							severity: "error",
							submissionId: receipt.submissionId,
							workflowInstanceId: event.instanceId,
						});
						throw new NonRetryableError(
							error instanceof Error
								? error.message
								: "Reviewer returned an invalid structured result",
						);
					}
				},
			);

			const publication = await step.do("map findings to diff", async () => {
				const sandbox = getSandbox(this.env.Sandbox, event.instanceId, {
					sleepAfter: config.sandboxSleepAfter,
				});
				await ensureReviewWorkspace({
					pull,
					sandbox,
					skillPath: repository.skill,
				});
				const diffs = new Map<string, string>();
				for (const path of new Set(
					review.findings
						.filter((finding) => finding.line !== null)
						.map((finding) => finding.path),
				)) {
					if (!isSafeRepositoryPath(path)) continue;
					const result = await sandbox.exec(
						`git --no-pager diff --no-ext-diff --no-textconv --unified=3 ${pull.baseSha}...${pull.headSha} -- ${shellQuote(path)}`,
						{ cwd: "/workspace/review/repository", timeout: 60_000 },
					);
					if (!result.success)
						throw new Error(`Could not read diff for ${path}`);
					diffs.set(path, result.stdout);
				}
				return prepareReviewPublication({
					deliveryId: request.deliveryId,
					diffsByPath: diffs,
					review,
				});
			});

			const published = await step.do("publish review", async () => {
				const client = createGitHubClient(this.env.GITHUB_TOKEN);
				return publishPreparedReview({
					client,
					commitId: pull.headSha,
					deliveryId: request.deliveryId,
					owner,
					publication,
					pullNumber: request.pullNumber,
					repo,
				});
			});

			return { reviewId: published.reviewId };
		} finally {
			try {
				await step.do(
					"destroy review sandbox",
					{
						retries: { backoff: "exponential", delay: "10 seconds", limit: 3 },
						timeout: "2 minutes",
					},
					async () => {
						const sandbox = getSandbox(this.env.Sandbox, event.instanceId, {
							sleepAfter: config.sandboxSleepAfter,
						});
						await sandbox.destroy();
					},
				);
			} finally {
				await step.do("release review admission", () =>
					coordinator.complete(event.instanceId),
				);
			}
		}
	}
}

export function coordinatorName(request: ReviewRequest) {
	return `${request.repository}#${request.pullNumber}`;
}

export function splitRepository(repository: string): [string, string] {
	const parts = repository.split("/");
	if (parts.length !== 2 || parts.some((part) => part.length === 0)) {
		throw new Error(`Invalid repository name: ${repository}`);
	}
	return [parts[0] as string, parts[1] as string];
}
