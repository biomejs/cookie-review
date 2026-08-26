import * as v from "valibot";

export const reviewRequestSchema = v.object({
	commentId: v.pipe(v.number(), v.integer(), v.minValue(1)),
	deliveryId: v.pipe(v.string(), v.minLength(1)),
	pullNumber: v.pipe(v.number(), v.integer(), v.minValue(1)),
	repository: v.pipe(v.string(), v.minLength(1)),
	sender: v.pipe(v.string(), v.minLength(1)),
});

export type ReviewRequest = v.InferOutput<typeof reviewRequestSchema>;

export type AdmissionResult =
	| { outcome: "accepted"; workflowId: string }
	| { outcome: "busy"; workflowId: string };
