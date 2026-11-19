import { getRepositoryConfig } from "../config.ts";
import { isOrganizationMember } from "../github/policy.ts";
import { detectBugReport, detectReproduction } from "./heuristics.ts";
import {
	buildJevInput,
	readJevProbability,
	type TriageQuestion,
} from "./jev.ts";
import type {
	CommentSnapshot,
	IssueSnapshot,
	IssueTriageRequest,
} from "./request.ts";

type TriagePolicy = NonNullable<
	ReturnType<typeof getRepositoryConfig>
>["triage"];

interface TriageServices {
	addLabel(request: IssueTriageRequest, label: string): Promise<void>;
	ask(model: string, input: Record<string, unknown>): Promise<unknown>;
	getComment(
		request: IssueTriageRequest,
		commentId: number,
	): Promise<CommentSnapshot | undefined>;
	getIssue(request: IssueTriageRequest): Promise<IssueSnapshot | undefined>;
	removeLabel(request: IssueTriageRequest, label: string): Promise<void>;
}

export async function processIssueTriageRequest(
	request: IssueTriageRequest,
	services: TriageServices,
) {
	const policy = getRepositoryConfig(request.repository)?.triage;
	if (!policy) return "ignored" as const;
	return request.event === "opened"
		? triageOpenedIssue(request, policy, services)
		: recheckReproduction(request, policy, services);
}

async function triageOpenedIssue(
	request: IssueTriageRequest,
	policy: TriagePolicy,
	services: TriageServices,
) {
	const issue = await services.getIssue(request);
	if (
		!issue ||
		issue.isPullRequest ||
		issue.state !== "open" ||
		issue.labels.includes(policy.needsReproLabel) ||
		isOrganizationMember(issue.authorAssociation)
	) {
		return "ignored" as const;
	}

	const bugReport = detectBugReport(issue, policy);
	if (bugReport === "no") return "not-bug" as const;
	const reproduction = detectReproduction(
		issue.body,
		linkPolicy(request, policy),
	);
	if (reproduction.verdict === "yes") return "has-reproduction" as const;

	let bugProbability = 1;
	let reproductionProbability = 0;
	const questions: TriageQuestion[] = [];
	if (bugReport === "unknown") questions.push("isBugReport");
	if (reproduction.verdict === "unknown") questions.push("hasReproduction");
	if (questions.length > 0) {
		const response = await services.ask(
			policy.model,
			buildJevInput({
				issue,
				links: reproduction.candidates,
				playgroundUrl: policy.playgroundUrl,
				questions,
			}),
		);
		if (bugReport === "unknown") {
			bugProbability = readJevProbability(response, "isBugReport");
		}
		if (reproduction.verdict === "unknown") {
			reproductionProbability = readJevProbability(response, "hasReproduction");
		}
	}

	const doubt = 1 - policy.minimumConfidence;
	if (bugProbability <= doubt) return "not-bug" as const;
	if (reproductionProbability >= policy.minimumConfidence) {
		return "has-reproduction" as const;
	}
	if (
		bugProbability < policy.minimumConfidence ||
		reproductionProbability > doubt
	) {
		return "uncertain" as const;
	}
	await services.addLabel(request, policy.needsReproLabel);
	return "labeled" as const;
}

// An issue waiting for a reproduction returns to triage once its body or an
// outside contributor's comment links one.
async function recheckReproduction(
	request: Exclude<IssueTriageRequest, { event: "opened" }>,
	policy: TriagePolicy,
	services: TriageServices,
) {
	const issue = await services.getIssue(request);
	if (
		!issue ||
		issue.isPullRequest ||
		issue.state !== "open" ||
		!issue.labels.includes(policy.needsReproLabel)
	) {
		return "ignored" as const;
	}

	let comment: string | undefined;
	if (request.event === "commented") {
		const snapshot = await services.getComment(request, request.commentId);
		if (!snapshot || isOrganizationMember(snapshot.authorAssociation)) {
			return "ignored" as const;
		}
		comment = snapshot.body;
	} else if (isOrganizationMember(issue.authorAssociation)) {
		return "ignored" as const;
	}

	const reproduction = detectReproduction(
		comment ?? issue.body,
		linkPolicy(request, policy),
	);
	if (reproduction.verdict === "no") return "no-reproduction" as const;
	if (reproduction.verdict === "unknown") {
		const response = await services.ask(
			policy.model,
			buildJevInput({
				comment,
				issue,
				links: reproduction.candidates,
				playgroundUrl: policy.playgroundUrl,
				questions: ["hasReproduction"],
			}),
		);
		const probability = readJevProbability(response, "hasReproduction");
		if (probability <= 1 - policy.minimumConfidence) {
			return "no-reproduction" as const;
		}
		if (probability < policy.minimumConfidence) return "uncertain" as const;
	}

	// Removing the needs-reproduction label last lets a retry after a partial
	// failure find the issue still awaiting a reproduction and finish the swap.
	await services.addLabel(request, policy.needsTriageLabel);
	await services.removeLabel(request, policy.needsReproLabel);
	return "retriaged" as const;
}

function linkPolicy(request: IssueTriageRequest, policy: TriagePolicy) {
	const [owner = ""] = request.repository.split("/");
	return { owner, playgroundUrl: policy.playgroundUrl };
}
