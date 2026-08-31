import { describe, expect, it, vi } from "vitest";
import { processReviewRequest } from "../src/queue.ts";
import type { ReviewRequest } from "../src/review/request.ts";

const request: ReviewRequest = {
	commentId: 1,
	deliveryId: "delivery-1",
	pullNumber: 123,
	repository: "biomejs/biome",
	sender: "maintainer",
};

describe("Queue review processing", () => {
	it("starts an admitted maintainer review", async () => {
		const reactAcknowledge = vi.fn();
		const reactBusy = vi.fn();
		const result = await processReviewRequest(request, {
			admit: async () => ({ outcome: "accepted", workflowId: "delivery-1" }),
			getPermission: async () => "write",
			reactAcknowledge,
			reactBusy,
		});

		expect(result).toBe("accepted");
		expect(reactAcknowledge).toHaveBeenCalledOnce();
		expect(reactBusy).not.toHaveBeenCalled();
	});

	it("reacts once and discards a busy request", async () => {
		const reactAcknowledge = vi.fn();
		const reactBusy = vi.fn();
		const result = await processReviewRequest(request, {
			admit: async () => ({ outcome: "busy", workflowId: "delivery-0" }),
			getPermission: async () => "admin",
			reactAcknowledge,
			reactBusy,
		});

		expect(result).toBe("busy");
		expect(reactAcknowledge).not.toHaveBeenCalled();
		expect(reactBusy).toHaveBeenCalledOnce();
	});

	it("ignores unauthorized and unconfigured requests before admission", async () => {
		const admit = vi.fn();
		expect(
			await processReviewRequest(request, {
				admit,
				getPermission: async () => "read",
				reactAcknowledge: vi.fn(),
				reactBusy: vi.fn(),
			}),
		).toBe("ignored");
		expect(
			await processReviewRequest(
				{ ...request, repository: "other/repository" },
				{
					admit,
					getPermission: vi.fn(),
					reactAcknowledge: vi.fn(),
					reactBusy: vi.fn(),
				},
			),
		).toBe("ignored");
		expect(admit).not.toHaveBeenCalled();
	});
});
