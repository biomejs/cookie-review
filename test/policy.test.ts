import { describe, expect, it } from "vitest";
import {
	containsTrigger,
	hasReviewPermission,
	isActiveWorkflowStatus,
	isConfiguredReviewRequest,
} from "../src/github/policy.ts";

describe("GitHub review policy", () => {
	it("matches the configured command with boundaries and flexible whitespace", () => {
		expect(
			containsTrigger("please @biome-cookie review", "@biome-cookie review"),
		).toBe(true);
		expect(
			containsTrigger("@BIOME-COOKIE\treview!", "@biome-cookie review"),
		).toBe(true);
		expect(
			containsTrigger("@biome-cookie reviewer", "@biome-cookie review"),
		).toBe(false);
	});

	it("only accepts configured pull requests", () => {
		expect(
			isConfiguredReviewRequest({
				commentBody: "@biome-cookie review",
				isPullRequest: true,
				repository: "biomejs/biome",
			}),
		).toBe(true);
		expect(
			isConfiguredReviewRequest({
				commentBody: "@biome-cookie review",
				isPullRequest: false,
				repository: "biomejs/biome",
			}),
		).toBe(false);
		expect(
			isConfiguredReviewRequest({
				commentBody: "@biome-cookie review",
				isPullRequest: true,
				repository: "biomejs/unknown",
			}),
		).toBe(false);
	});

	it("requires write-level permission", () => {
		expect(hasReviewPermission("admin")).toBe(true);
		expect(hasReviewPermission("write")).toBe(true);
		expect(hasReviewPermission("read")).toBe(false);
		expect(hasReviewPermission("triage")).toBe(false);
	});

	it("keeps all non-terminal Workflow states active", () => {
		for (const status of [
			"paused",
			"queued",
			"running",
			"unknown",
			"waiting",
			"waitingForPause",
		]) {
			expect(isActiveWorkflowStatus(status)).toBe(true);
		}
		for (const status of ["complete", "errored", "terminated"]) {
			expect(isActiveWorkflowStatus(status)).toBe(false);
		}
	});
});
