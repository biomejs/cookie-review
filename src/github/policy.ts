import { config, getRepositoryConfig } from "../config.ts";

const ORGANIZATION_ASSOCIATIONS = new Set(["MEMBER", "OWNER"]);
const ACTIVE_WORKFLOW_STATUSES = new Set([
	"paused",
	"queued",
	"running",
	"unknown",
	"waiting",
	"waitingForPause",
]);

export function isConfiguredReviewRequest(input: {
	commentBody: string;
	isPullRequest: boolean;
	repository: string;
}) {
	return (
		input.isPullRequest &&
		getRepositoryConfig(input.repository) !== undefined &&
		containsTrigger(input.commentBody, config.trigger)
	);
}

export function isConfiguredIssueTriageRequest(input: {
	authorAssociation: string;
	repository: string;
}) {
	return (
		getRepositoryConfig(input.repository) !== undefined &&
		!isOrganizationMember(input.authorAssociation)
	);
}

export function isOrganizationMember(authorAssociation: string) {
	return ORGANIZATION_ASSOCIATIONS.has(authorAssociation);
}

export function containsTrigger(body: string, trigger: string) {
	const escaped = trigger.trim().split(/\s+/).map(escapeRegExp).join("\\s+");
	const pattern = new RegExp(`(^|\\s)${escaped}(?=$|\\s|[.,!?;:])`, "i");
	return pattern.test(body);
}

export function hasReviewPermission(permission: string) {
	return permission === "admin" || permission === "write";
}

export function isActiveWorkflowStatus(status: string) {
	return ACTIVE_WORKFLOW_STATUSES.has(status);
}

function escapeRegExp(value: string) {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
