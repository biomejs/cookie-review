import { getRepositoryConfig } from "../config.ts";
import { isOrganizationMember } from "../github/policy.ts";
import { detectBugReport, detectReproduction } from "./heuristics.ts";
import {
	buildJevInput,
	readJevProbability,
	type TriageQuestion,
} from "./jev.ts";
import type { IssueSnapshot, IssueTriageRequest } from "./request.ts";

interface TriageServices {
	addLabel(request: IssueTriageRequest, label: string): Promise<void>;
	ask(model: string, input: Record<string, unknown>): Promise<unknown>;
	getIssue(request: IssueTriageRequest): Promise<IssueSnapshot | undefined>;
}

export async function processIssueTriageRequest(
	request: IssueTriageRequest,
	services: TriageServices,
) {
	const policy = getRepositoryConfig(request.repository)?.triage;
	if (!policy) return "ignored" as const;
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
	const [owner = ""] = request.repository.split("/");
	const reproduction = detectReproduction(issue.body, {
		owner,
		playgroundUrl: policy.playgroundUrl,
	});
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
