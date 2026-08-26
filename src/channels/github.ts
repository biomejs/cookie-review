// flue-blueprint: channel/github@1

import { env } from "cloudflare:workers";
import type { ReviewRequest } from "../review/request.ts";
import { createReviewChannel } from "./review.ts";

interface ReviewQueue {
	send(message: ReviewRequest): Promise<unknown>;
}

const bindings = env as unknown as { REVIEW_REQUESTS: ReviewQueue };

export const channel = createReviewChannel({
	queue: bindings.REVIEW_REQUESTS,
	webhookSecret: requiredEnvironmentVariable("GITHUB_WEBHOOK_SECRET"),
});

function requiredEnvironmentVariable(name: string) {
	const value = process.env[name];
	if (!value) throw new Error(`${name} is required`);
	return value;
}
