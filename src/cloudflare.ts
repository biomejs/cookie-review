import {
	Sandbox as CloudflareSandbox,
	ContainerProxy,
} from "@cloudflare/sandbox";
import type { Octokit, RestEndpointMethodTypes } from "@octokit/rest";
import * as v from "valibot";
import { config } from "./config.ts";
import { ReviewCoordinator } from "./coordinator.ts";
import { createGitHubClient, getErrorStatus } from "./github/client.ts";
import { processReviewRequest } from "./queue.ts";
import { type ReviewRequest, reviewRequestSchema } from "./review/request.ts";
import { VERIFICATION_SETUP_HOSTS } from "./review/verification.ts";
import { processIssueTriageRequest } from "./triage/process.ts";
import {
	type IssueSnapshot,
	type IssueTriageRequest,
	issueTriageRequestSchema,
} from "./triage/request.ts";
import {
	coordinatorName,
	ReviewWorkflow,
	splitRepository,
} from "./workflows/review.ts";

export class VerificationSandbox extends CloudflareSandbox {
	enableInternet = false;
	interceptHttps = true;
	allowedHosts = [...VERIFICATION_SETUP_HOSTS];
}

export {
	CloudflareSandbox as Sandbox,
	ContainerProxy,
	ReviewCoordinator,
	ReviewWorkflow,
};

interface WorkerEnv {
	AI: Ai;
	GITHUB_TOKEN: string;
	REVIEW_COORDINATOR: DurableObjectNamespace<ReviewCoordinator>;
}

type GitHubClient = InstanceType<typeof Octokit>;

export default {
	async queue(batch: MessageBatch<unknown>, env: WorkerEnv) {
		const client = createGitHubClient(env.GITHUB_TOKEN);
		await Promise.all(
			batch.messages.map((message) =>
				batch.queue === config.issueTriageQueue
					? consumeIssueTriageRequest(message, client, env)
					: consumeReviewRequest(message, client, env),
			),
		);
	},
} satisfies ExportedHandler<WorkerEnv>;

async function consumeReviewRequest(
	message: Message<unknown>,
	client: GitHubClient,
	env: WorkerEnv,
) {
	const parsed = v.safeParse(reviewRequestSchema, message.body);
	if (!parsed.success) {
		console.error("Discarding invalid review request", parsed.issues);
		message.ack();
		return;
	}

	try {
		await processReviewRequest(parsed.output, {
			admit(request) {
				return env.REVIEW_COORDINATOR.getByName(coordinatorName(request)).admit(
					request,
				);
			},
			getPermission: (request) => getPermission(client, request),
			reactAcknowledge: (request) =>
				react(client, request, config.acknowledgeReaction),
			reactBusy: (request) => react(client, request, config.busyReaction),
		});
		message.ack();
	} catch (error) {
		console.error("Review request processing failed", error);
		message.retry({ delaySeconds: 30 });
	}
}

async function consumeIssueTriageRequest(
	message: Message<unknown>,
	client: GitHubClient,
	env: WorkerEnv,
) {
	const parsed = v.safeParse(issueTriageRequestSchema, message.body);
	if (!parsed.success) {
		console.error("Discarding invalid issue triage request", parsed.issues);
		message.ack();
		return;
	}

	try {
		const outcome = await processIssueTriageRequest(parsed.output, {
			addLabel: (request, label) => addLabel(client, request, label),
			ask: (model, input) => env.AI.run(model, input),
			getIssue: (request) => getIssue(client, request),
		});
		console.log({
			event: "issue.triage.completed",
			issueNumber: parsed.output.issueNumber,
			outcome,
			repository: parsed.output.repository,
		});
		message.ack();
	} catch (error) {
		console.error("Issue triage request processing failed", error);
		message.retry({ delaySeconds: 30 });
	}
}

async function getIssue(
	client: GitHubClient,
	request: IssueTriageRequest,
): Promise<IssueSnapshot | undefined> {
	const [owner, repo] = splitRepository(request.repository);
	try {
		const { data } = await client.rest.issues.get({
			issue_number: request.issueNumber,
			owner,
			repo,
		});
		return {
			authorAssociation: data.author_association ?? "NONE",
			body: data.body ?? "",
			isPullRequest: data.pull_request !== undefined,
			labels: data.labels.flatMap((label) =>
				typeof label === "string" ? label : (label.name ?? []),
			),
			state: data.state,
			title: data.title,
			type: data.type?.name,
		};
	} catch (error) {
		const status = getErrorStatus(error);
		if (status === 404 || status === 410) return undefined;
		throw error;
	}
}

async function addLabel(
	client: GitHubClient,
	request: IssueTriageRequest,
	label: string,
) {
	const [owner, repo] = splitRepository(request.repository);
	await client.rest.issues.addLabels({
		issue_number: request.issueNumber,
		labels: [label],
		owner,
		repo,
	});
}

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

async function react(
	client: GitHubClient,
	request: ReviewRequest,
	content: RestEndpointMethodTypes["reactions"]["createForIssueComment"]["parameters"]["content"],
) {
	const [owner, repo] = splitRepository(request.repository);
	await client.rest.reactions.createForIssueComment({
		comment_id: request.commentId,
		content,
		owner,
		repo,
	});
}
