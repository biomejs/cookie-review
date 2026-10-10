// flue-blueprint: channel/github@1

import { env } from "cloudflare:workers";
import type { ReviewRequest } from "../review/request.ts";
import type { IssueTriageRequest } from "../triage/request.ts";
import { createReviewChannel } from "./review.ts";

interface Queue<Message> {
	send(message: Message): Promise<unknown>;
}

const bindings = env as unknown as {
	ISSUE_TRIAGE_REQUESTS: Queue<IssueTriageRequest>;
	REVIEW_REQUESTS: Queue<ReviewRequest>;
};

export const channel = createReviewChannel({
	queue: bindings.REVIEW_REQUESTS,
	triageQueue: bindings.ISSUE_TRIAGE_REQUESTS,
	webhookSecret: requiredEnvironmentVariable("GITHUB_WEBHOOK_SECRET"),
});

function requiredEnvironmentVariable(name: string) {
	const value = process.env[name];
	if (!value) throw new Error(`${name} is required`);
	return value;
}
