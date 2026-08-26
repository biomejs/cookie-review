import { describe, expect, it } from "vitest";
import {
	ACTIVE_REVIEW_KEY,
	admitReview,
	type CoordinatorStorage,
	type WorkflowController,
} from "../src/admission.ts";
import { config } from "../src/config.ts";
import type { ReviewRequest } from "../src/review/request.ts";

describe("per-PR review admission", () => {
	it("accepts one request, rejects another while active, and accepts after completion", async () => {
		const storage = new MemoryStorage();
		const workflow = new MemoryWorkflows();

		expect(await admit(storage, workflow, request("delivery-1"))).toEqual({
			outcome: "accepted",
			workflowId: "delivery-1",
		});
		expect(await admit(storage, workflow, request("delivery-2"))).toEqual({
			outcome: "busy",
			workflowId: "delivery-1",
		});

		workflow.statuses.set("delivery-1", "complete");
		expect(await admit(storage, workflow, request("delivery-3"))).toEqual({
			outcome: "accepted",
			workflowId: "delivery-3",
		});
		expect(workflow.created).toEqual(["delivery-1", "delivery-3"]);
	});

	it("deduplicates accepted and rejected deliveries", async () => {
		const storage = new MemoryStorage();
		const workflow = new MemoryWorkflows();
		await admit(storage, workflow, request("delivery-1"));
		await admit(storage, workflow, request("delivery-2"));

		expect(await admit(storage, workflow, request("delivery-1"))).toEqual({
			outcome: "accepted",
			workflowId: "delivery-1",
		});
		expect(await admit(storage, workflow, request("delivery-2"))).toEqual({
			outcome: "busy",
			workflowId: "delivery-1",
		});
		expect(workflow.created).toEqual(["delivery-1"]);
	});

	it("recovers an unknown lock only after the stale threshold", async () => {
		const storage = new MemoryStorage();
		const workflow = new MemoryWorkflows();
		await storage.put(ACTIVE_REVIEW_KEY, {
			startedAt: 0,
			workflowId: "missing-workflow",
		});

		expect(
			await admit(
				storage,
				workflow,
				request("delivery-2"),
				config.reviewStaleAfterMs - 1,
			),
		).toEqual({ outcome: "busy", workflowId: "missing-workflow" });

		expect(
			await admit(
				storage,
				workflow,
				request("delivery-3"),
				config.reviewStaleAfterMs,
			),
		).toEqual({ outcome: "accepted", workflowId: "delivery-3" });
	});
});

class MemoryStorage implements CoordinatorStorage {
	readonly values = new Map<string, unknown>();

	async delete(key: string) {
		return this.values.delete(key);
	}

	async get<T>(key: string) {
		return this.values.get(key) as T | undefined;
	}

	async put<T>(key: string, value: T) {
		this.values.set(key, value);
	}
}

class MemoryWorkflows implements WorkflowController {
	readonly created: string[] = [];
	readonly statuses = new Map<string, string>();

	async create(options: Parameters<WorkflowController["create"]>[0]) {
		if (this.statuses.has(options.id)) throw new Error("duplicate");
		this.created.push(options.id);
		this.statuses.set(options.id, "queued");
	}

	async get(id: string) {
		if (!this.statuses.has(id)) throw new Error("missing");
		return {
			status: async () => ({ status: this.statuses.get(id) as string }),
		};
	}
}

function admit(
	storage: MemoryStorage,
	workflow: MemoryWorkflows,
	requestValue: ReviewRequest,
	now = 1,
) {
	return admitReview({ now, request: requestValue, storage, workflow });
}

function request(deliveryId: string): ReviewRequest {
	return {
		commentId: 1,
		deliveryId,
		pullNumber: 123,
		repository: "biomejs/biome",
		sender: "maintainer",
	};
}
