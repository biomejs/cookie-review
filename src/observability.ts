import {
	type AgentRunError,
	type FlueObservation,
	observe,
} from "@flue/runtime";

export interface FailureRecord {
	event: string;
	severity: "error" | "warn";
	[key: string]: unknown;
}

interface ReviewFailureContext {
	pullNumber: number;
	repository: string;
	workflowInstanceId: string;
}

export function createFlueFailureRecord(
	observation: FlueObservation,
): FailureRecord | undefined {
	const correlation = {
		agentName: observation.agentName,
		conversationId: observation.conversationId,
		instanceId: observation.instanceId,
		submissionId: observation.submissionId,
		timestamp: observation.timestamp,
	};

	if (observation.type === "turn" && observation.isError) {
		return {
			...correlation,
			api: observation.request.api,
			durationMs: observation.durationMs,
			error: observation.response.error,
			event: "flue.model_turn.failed",
			finishReason: observation.response.finishReason,
			gatewayLogId: observation.response.gatewayLogId,
			model: observation.request.requestedModel,
			provider: observation.request.providerName,
			providerFinishReason: observation.response.providerFinishReason,
			providerId: observation.request.providerId,
			purpose: observation.purpose,
			reasoningLevel: observation.request.reasoningLevel,
			responseModel: observation.response.responseModel,
			severity: "error",
			turnId: observation.turnId,
		};
	}

	if (
		observation.type === "submission_settled" &&
		observation.outcome !== "completed"
	) {
		return {
			...correlation,
			error: observation.error,
			event: `flue.submission.${observation.outcome}`,
			liveError: observation.errorInfo,
			outcome: observation.outcome,
			severity: observation.outcome === "failed" ? "error" : "warn",
		};
	}

	if (observation.type === "submission_recovery") {
		return {
			...correlation,
			attemptCount: observation.attemptCount,
			error: observation.error,
			event: "flue.submission.recovery",
			liveError: observation.errorInfo,
			maxAttempts: observation.maxAttempts,
			operation: observation.operation,
			outcome: observation.outcome,
			severity: observation.outcome === "terminated" ? "error" : "warn",
		};
	}

	return undefined;
}

export function installFlueFailureLogging() {
	observe((observation) => {
		const record = createFlueFailureRecord(observation);
		if (!record) return;
		if (record.severity === "error") console.error(record);
		else console.warn(record);
	});
}

export function createAgentRunFailureRecord(
	error: AgentRunError,
	context: ReviewFailureContext,
): FailureRecord {
	return {
		...context,
		cause: error.cause,
		event: "review.agent_run.failed",
		outcome: error.outcome,
		severity: "error",
		submissionId: error.submissionId,
	};
}

export function agentRunFailureMessage(error: AgentRunError) {
	const cause = error.cause;
	const causeMessage =
		typeof cause === "object" &&
		cause !== null &&
		"message" in cause &&
		typeof cause.message === "string"
			? cause.message
			: typeof cause === "string"
				? cause
				: undefined;
	return causeMessage
		? `${error.message} Cause: ${causeMessage}`
		: error.message;
}

export function serializeError(error: unknown) {
	if (!(error instanceof Error)) return error;
	return {
		cause: error.cause,
		message: error.message,
		name: error.name,
		stack: error.stack,
	};
}
