import { getRepositoryConfig } from "./config.ts";
import { hasReviewPermission } from "./github/policy.ts";
import type { AdmissionResult, ReviewRequest } from "./review/request.ts";

interface QueueServices {
	admit(request: ReviewRequest): Promise<AdmissionResult>;
	getPermission(request: ReviewRequest): Promise<string | undefined>;
	reactBusy(request: ReviewRequest): Promise<void>;
}

export async function processReviewRequest(
	request: ReviewRequest,
	services: QueueServices,
) {
	if (!getRepositoryConfig(request.repository)) return "ignored" as const;
	const permission = await services.getPermission(request);
	if (!permission || !hasReviewPermission(permission))
		return "ignored" as const;

	const admission = await services.admit(request);
	if (admission.outcome === "busy") {
		await services.reactBusy(request);
		return "busy" as const;
	}
	return "accepted" as const;
}
