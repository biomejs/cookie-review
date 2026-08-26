export const config = {
	busyReaction: "-1",
	reviewStaleAfterMs: 24 * 60 * 60 * 1000,
	sandboxSleepAfter: "2h",
	trigger: "@biome-cookie review",
	repositories: {
		"biomejs/biome": {
			model: "cloudflare/@cf/moonshotai/kimi-k2.7-code",
			skill: ".claude/skills/biome-code-review/SKILL.md",
			thinkingLevel: "high",
		},
	},
} as const;

export type RepositoryName = keyof typeof config.repositories;

export function getRepositoryConfig(repository: string) {
	if (!(repository in config.repositories)) return undefined;
	return config.repositories[repository as RepositoryName];
}
