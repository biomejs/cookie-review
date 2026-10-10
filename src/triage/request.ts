import * as v from "valibot";

export const issueTriageRequestSchema = v.object({
	deliveryId: v.pipe(v.string(), v.minLength(1)),
	issueNumber: v.pipe(v.number(), v.integer(), v.minValue(1)),
	repository: v.pipe(v.string(), v.minLength(1)),
});

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
