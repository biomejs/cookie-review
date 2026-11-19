import * as v from "valibot";

const issueReference = {
	deliveryId: v.pipe(v.string(), v.minLength(1)),
	issueNumber: v.pipe(v.number(), v.integer(), v.minValue(1)),
	repository: v.pipe(v.string(), v.minLength(1)),
};

// `opened` is optional so requests enqueued before the event field existed
// still parse as newly opened issues.
export const issueTriageRequestSchema = v.union([
	v.object({
		...issueReference,
		event: v.optional(v.literal("opened"), "opened"),
	}),
	v.object({ ...issueReference, event: v.literal("edited") }),
	v.object({
		...issueReference,
		commentId: v.pipe(v.number(), v.integer(), v.minValue(1)),
		event: v.literal("commented"),
	}),
]);

export type IssueTriageRequest = v.InferOutput<typeof issueTriageRequestSchema>;

export interface IssueSnapshot {
	authorAssociation: string;
	body: string;
	isPullRequest: boolean;
	labels: string[];
	state: string;
	title: string;
	type: string | undefined;
}

export interface CommentSnapshot {
	authorAssociation: string;
	body: string;
}
