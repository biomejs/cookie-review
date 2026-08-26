import { DurableObject } from "cloudflare:workers";
import {
	ACTIVE_REVIEW_KEY,
	type ActiveReview,
	admitReview,
} from "./admission.ts";
import type { ReviewRequest } from "./review/request.ts";

interface CoordinatorEnv {
	REVIEW_WORKFLOW: Workflow<ReviewRequest>;
}

export class ReviewCoordinator extends DurableObject<CoordinatorEnv> {
	async admit(request: ReviewRequest) {
		return this.ctx.blockConcurrencyWhile(() =>
			admitReview({
				now: Date.now(),
				request,
				storage: this.ctx.storage,
				workflow: this.env.REVIEW_WORKFLOW,
			}),
		);
	}

	async complete(workflowId: string): Promise<void> {
		await this.ctx.blockConcurrencyWhile(async () => {
			const active =
				await this.ctx.storage.get<ActiveReview>(ACTIVE_REVIEW_KEY);
			if (active?.workflowId === workflowId) {
				await this.ctx.storage.delete(ACTIVE_REVIEW_KEY);
			}
		});
	}
}
