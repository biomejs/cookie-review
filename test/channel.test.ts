import { createHmac } from "node:crypto";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { createReviewChannel } from "../src/channels/review.ts";
import type { ReviewRequest } from "../src/review/request.ts";
import type { IssueTriageRequest } from "../src/triage/request.ts";

const secret = "test-webhook-secret";

describe("GitHub channel", () => {
	it("enqueues a signed review request", async () => {
		const messages: ReviewRequest[] = [];
		const app = createApp(messages);
		const body = JSON.stringify(payload());
		const response = await app.request("/channels/github/webhook", {
			body,
			headers: signedHeaders(body),
			method: "POST",
		});

		expect(response.status).toBe(200);
		expect(messages).toEqual([
			{
				commentId: 42,
				deliveryId: "delivery-1",
				pullNumber: 123,
				repository: "biomejs/biome",
				sender: "maintainer",
			},
		]);
	});

	it("rejects an invalid signature before enqueueing", async () => {
		const messages: ReviewRequest[] = [];
		const app = createApp(messages);
		const body = JSON.stringify(payload());
		const response = await app.request("/channels/github/webhook", {
			body,
			headers: { ...signedHeaders(body), "x-hub-signature-256": "sha256=bad" },
			method: "POST",
		});

		expect(response.status).toBe(401);
		expect(messages).toEqual([]);
	});

	it("acknowledges non-PR issue comments without enqueueing", async () => {
		const messages: ReviewRequest[] = [];
		const app = createApp(messages);
		const body = JSON.stringify(payload({ pullRequest: false }));
		const response = await app.request("/channels/github/webhook", {
			body,
			headers: signedHeaders(body),
			method: "POST",
		});

		expect(response.status).toBe(200);
		expect(messages).toEqual([]);
	});

	it("enqueues a newly opened issue for triage", async () => {
		const messages: ReviewRequest[] = [];
		const triage: IssueTriageRequest[] = [];
		const app = createApp(messages, triage);
		const body = JSON.stringify(issuePayload());
		const response = await app.request("/channels/github/webhook", {
			body,
			headers: signedHeaders(body, "issues"),
			method: "POST",
		});

		expect(response.status).toBe(200);
		expect(messages).toEqual([]);
		expect(triage).toEqual([
			{
				deliveryId: "delivery-1",
				issueNumber: 456,
				repository: "biomejs/biome",
			},
		]);
	});

	it("does not triage organization members, edits, or other repositories", async () => {
		const triage: IssueTriageRequest[] = [];
		const app = createApp([], triage);
		for (const payload of [
			issuePayload({ authorAssociation: "MEMBER" }),
			issuePayload({ authorAssociation: "OWNER" }),
			issuePayload({ action: "edited" }),
			issuePayload({ repository: "other/repository" }),
		]) {
			const body = JSON.stringify(payload);
			const response = await app.request("/channels/github/webhook", {
				body,
				headers: signedHeaders(body, "issues"),
				method: "POST",
			});
			expect(response.status).toBe(200);
		}

		expect(triage).toEqual([]);
	});
});

function createApp(
	messages: ReviewRequest[],
	triage: IssueTriageRequest[] = [],
) {
	const channel = createReviewChannel({
		queue: {
			async send(message) {
				messages.push(message);
			},
		},
		triageQueue: {
			async send(message) {
				triage.push(message);
			},
		},
		webhookSecret: secret,
	});
	const app = new Hono();
	app.route("/channels/github", channel.route());
	return app;
}

function signedHeaders(body: string, event = "issue_comment") {
	return {
		"content-type": "application/json",
		"x-github-delivery": "delivery-1",
		"x-github-event": event,
		"x-hub-signature-256": `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`,
	};
}

function payload(options: { pullRequest?: boolean } = {}) {
	return {
		action: "created",
		comment: { body: "please @biome-cookie review", id: 42 },
		issue: {
			number: 123,
			...(options.pullRequest === false
				? {}
				: { pull_request: { url: "pull" } }),
		},
		repository: { full_name: "biomejs/biome" },
		sender: { login: "maintainer" },
	};
}

function issuePayload(
	options: {
		action?: string;
		authorAssociation?: string;
		repository?: string;
	} = {},
) {
	return {
		action: options.action ?? "opened",
		issue: {
			author_association: options.authorAssociation ?? "NONE",
			number: 456,
		},
		repository: { full_name: options.repository ?? "biomejs/biome" },
		sender: { login: "reporter" },
	};
}
