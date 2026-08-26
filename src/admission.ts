import { config } from "./config.ts";
import { isActiveWorkflowStatus } from "./github/policy.ts";
import type { AdmissionResult, ReviewRequest } from "./review/request.ts";

export interface ActiveReview {
	startedAt: number;
	workflowId: string;
}

export interface CoordinatorStorage {
	delete(key: string): Promise<boolean>;
	get<T>(key: string): Promise<T | undefined>;
	put<T>(key: string, value: T): Promise<void>;
}

interface WorkflowInstanceHandle {
	status(): Promise<{ status: string }>;
}

export interface WorkflowController {
	create(options: {
		id: string;
		params: ReviewRequest;
		retention: {
			errorRetention: "7 days";
			successRetention: "7 days";
		};
	}): Promise<unknown>;
	get(id: string): Promise<WorkflowInstanceHandle>;
}

export const ACTIVE_REVIEW_KEY = "active";

export async function admitReview(input: {
	now: number;
	request: ReviewRequest;
	storage: CoordinatorStorage;
	workflow: WorkflowController;
}): Promise<AdmissionResult> {
	const deliveryKey = `delivery:${input.request.deliveryId}`;
	const previous = await input.storage.get<AdmissionResult>(deliveryKey);
	if (previous) return previous;

	const active = await input.storage.get<ActiveReview>(ACTIVE_REVIEW_KEY);
	if (active?.workflowId === input.request.deliveryId) {
		await ensureWorkflow(input.workflow, input.request);
		const result = accepted(input.request.deliveryId);
		await input.storage.put(deliveryKey, result);
		return result;
	}

	if (active) {
		const status = await getWorkflowStatus(input.workflow, active.workflowId);
		const isStaleUnknown =
			status === "unknown" &&
			input.now - active.startedAt >= config.reviewStaleAfterMs;

		if (isActiveWorkflowStatus(status) && !isStaleUnknown) {
			const result: AdmissionResult = {
				outcome: "busy",
				workflowId: active.workflowId,
			};
			await input.storage.put(deliveryKey, result);
			return result;
		}

		await input.storage.delete(ACTIVE_REVIEW_KEY);
	}

	await input.storage.put<ActiveReview>(ACTIVE_REVIEW_KEY, {
		startedAt: input.now,
		workflowId: input.request.deliveryId,
	});

	await ensureWorkflow(input.workflow, input.request);
	const result = accepted(input.request.deliveryId);
	await input.storage.put(deliveryKey, result);
	return result;
}

async function ensureWorkflow(
	workflow: WorkflowController,
	request: ReviewRequest,
) {
	try {
		await workflow.get(request.deliveryId);
		return;
	} catch {
		try {
			await workflow.create({
				id: request.deliveryId,
				params: request,
				retention: {
					errorRetention: "7 days",
					successRetention: "7 days",
				},
			});
			return;
		} catch {
			// Creation can succeed before Queue acknowledgement; verify that instance.
			await workflow.get(request.deliveryId);
		}
	}
}

async function getWorkflowStatus(
	workflow: WorkflowController,
	workflowId: string,
) {
	try {
		const instance = await workflow.get(workflowId);
		return (await instance.status()).status;
	} catch {
		return "unknown";
	}
}

function accepted(workflowId: string): AdmissionResult {
	return { outcome: "accepted", workflowId };
}
