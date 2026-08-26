import { Octokit } from "@octokit/rest";

export function createGitHubClient(token: string) {
	return new Octokit({ auth: token });
}

export function getErrorStatus(error: unknown) {
	if (
		typeof error === "object" &&
		error !== null &&
		"status" in error &&
		typeof error.status === "number"
	) {
		return error.status;
	}
	return undefined;
}
