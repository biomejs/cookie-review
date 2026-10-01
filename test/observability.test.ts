import { AgentRunError, type FlueObservation } from "@flue/runtime";
import { describe, expect, it } from "vitest";
import {
	agentRunFailureMessage,
	createAgentRunFailureRecord,
	createFlueFailureRecord,
	serializeError,
} from "../src/observability.ts";

describe("failure observability", () => {
	it("records provider diagnostics for failed model turns", () => {
		const record = createFlueFailureRecord({
			agentName: "Reviewer",
			conversationId: "default",
			durationMs: 1234,
			eventIndex: 7,
			instanceId: "workflow-1",
			isError: true,
			purpose: "agent",
			request: {
				api: "workers-ai",
				providerId: "cloudflare",
				providerName: "cloudflare",
				reasoningLevel: "high",
				requestedModel: "@cf/moonshotai/kimi-k2.7-code",
			},
			response: {
				error: { message: "provider request failed", type: "provider_error" },
				finishReason: "error",
				gatewayLogId: "gateway-log-1",
				providerFinishReason: "error",
			},
			submissionId: "submission-1",
			timestamp: "2026-09-30T12:00:00.000Z",
			turnId: "turn-1",
			type: "turn",
			v: 3,
		} as FlueObservation);

		expect(record).toMatchObject({
			error: { message: "provider request failed", type: "provider_error" },
			event: "flue.model_turn.failed",
			finishReason: "error",
			gatewayLogId: "gateway-log-1",
			model: "@cf/moonshotai/kimi-k2.7-code",
			providerFinishReason: "error",
			reasoningLevel: "high",
			severity: "error",
			submissionId: "submission-1",
			turnId: "turn-1",
		});
	});

	it("records terminal settlement details", () => {
		const record = createFlueFailureRecord({
			agentName: "Reviewer",
			error: {
				message: "The operation failed.",
				meta: { reason: "upstream error" },
				type: "operation_failed",
			},
			errorInfo: {
				message: "upstream error",
				stack: "stack",
				type: "operation_failed",
			},
			eventIndex: 8,
			instanceId: "workflow-1",
			outcome: "failed",
			submissionId: "submission-1",
			timestamp: "2026-09-30T12:00:01.000Z",
			type: "submission_settled",
			v: 3,
		} as FlueObservation);

		expect(record).toMatchObject({
			error: {
				meta: { reason: "upstream error" },
				type: "operation_failed",
			},
			event: "flue.submission.failed",
			liveError: { message: "upstream error", stack: "stack" },
			severity: "error",
			submissionId: "submission-1",
		});
	});

	it("surfaces the durable cause of an agent run failure", () => {
		const error = new AgentRunError({
			cause: {
				message: "Workers AI rejected the request",
				type: "operation_failed",
			},
			outcome: "failed",
			submissionId: "submission-1",
		});

		expect(
			createAgentRunFailureRecord(error, {
				pullNumber: 123,
				repository: "biomejs/biome",
				workflowInstanceId: "workflow-1",
			}),
		).toMatchObject({
			cause: {
				message: "Workers AI rejected the request",
				type: "operation_failed",
			},
			event: "review.agent_run.failed",
			outcome: "failed",
			severity: "error",
			submissionId: "submission-1",
		});
		expect(agentRunFailureMessage(error)).toContain(
			"Workers AI rejected the request",
		);
	});

	it("serializes unexpected errors without losing their cause", () => {
		const error = new Error("invalid result", {
			cause: { field: "review" },
		});
		expect(serializeError(error)).toMatchObject({
			cause: { field: "review" },
			message: "invalid result",
			name: "Error",
		});
	});
});
