export const config = {
	acknowledgeReaction: "eyes",
	busyReaction: "-1",
	issueTriageQueue: "cookie-review-issue-triage",
	reviewStaleAfterMs: 24 * 60 * 60 * 1000,
	sandboxSleepAfter: "2h",
	trigger: "@biome-cookie review",
	repositories: {
		"biomejs/biome": {
			model: "cloudflare/@cf/zai-org/glm-5.3",
			skill: ".agents/skills/biome-code-review/SKILL.md",
			thinkingLevel: "high",
			triage: {
				bugIssueTypes: ["Bug"],
				bugTemplateHeading: "Environment information",
				minimumConfidence: 0.7,
				model: "typesafe/jev",
				needsReproLabel: "S-Needs repro",
				needsTriageLabel: "S-Needs triage",
				playgroundUrl: "https://biomejs.dev/playground",
			},
			verification: {
				commandTimeoutMs: 15 * 60 * 1000,
				requiredFeatures: {
					biome_service: ["stable"],
				},
				rustToolchain: "1.98.1",
			},
		},
	},
	verificationSandboxSleepAfter: "30m",
} as const;

export type RepositoryName = keyof typeof config.repositories;

export function getRepositoryConfig(repository: string) {
	if (!(repository in config.repositories)) return undefined;
	return config.repositories[repository as RepositoryName];
}
