export type Verdict = "yes" | "no" | "unknown";

const HEADING_PREFIX = /^#{1,6}\s+/;
const URL_PATTERN = /https?:\/\/[^\s<>()[\]"'`]+/g;
const TRAILING_PUNCTUATION = /[.,;:!?*_]+$/;
const GITHUB_HOSTS = new Set(["github.com", "www.github.com"]);
// First path segments on github.com that are never a repository owner.
const NON_OWNER_SEGMENTS = new Set([
	"apps",
	"features",
	"marketplace",
	"orgs",
	"sponsors",
	"topics",
	"user-attachments",
	"users",
]);
const REPRODUCTION_REPOSITORY = /repro/i;

export function detectBugReport(
	issue: { body: string; type: string | undefined },
	policy: { bugIssueTypes: readonly string[]; bugTemplateHeading: string },
): Verdict {
	if (issue.type !== undefined) {
		return policy.bugIssueTypes.includes(issue.type) ? "yes" : "no";
	}
	const heading = policy.bugTemplateHeading.toLowerCase();
	const usesBugTemplate = issue.body
		.split("\n")
		.some(
			(line) =>
				HEADING_PREFIX.test(line) &&
				line.replace(HEADING_PREFIX, "").trim().toLowerCase() === heading,
		);
	return usesBugTemplate ? "yes" : "unknown";
}

export function detectReproduction(
	body: string,
	policy: { owner: string; playgroundUrl: string },
): { candidates: string[]; verdict: Verdict } {
	const playground = new URL(policy.playgroundUrl);
	const candidates = new Set<string>();
	for (const url of extractUrls(body)) {
		if (isPlaygroundLink(url, playground)) {
			return { candidates: [], verdict: "yes" };
		}
		const repository = parseGitHubRepository(url);
		if (
			!repository ||
			repository.owner.toLowerCase() === policy.owner.toLowerCase()
		) {
			continue;
		}
		if (REPRODUCTION_REPOSITORY.test(repository.repo)) {
			return { candidates: [], verdict: "yes" };
		}
		if (repository.isRepositoryLink) candidates.add(url.href);
	}
	return candidates.size === 0
		? { candidates: [], verdict: "no" }
		: { candidates: [...candidates], verdict: "unknown" };
}

function extractUrls(body: string) {
	const urls: URL[] = [];
	for (const match of body.matchAll(URL_PATTERN)) {
		const candidate = match[0].replace(TRAILING_PUNCTUATION, "");
		if (URL.canParse(candidate)) urls.push(new URL(candidate));
	}
	return urls;
}

// The bare playground URL is the issue template's placeholder; only a link
// carrying shared state in its query or fragment reproduces anything.
// Subdomains host the playground of other release channels.
function isPlaygroundLink(url: URL, playground: URL) {
	const path = playground.pathname.replace(/\/$/, "");
	return (
		(url.hostname === playground.hostname ||
			url.hostname.endsWith(`.${playground.hostname}`)) &&
		(url.pathname === path || url.pathname === `${path}/`) &&
		(url.search.length > 1 || url.hash.length > 1)
	);
}

function parseGitHubRepository(url: URL) {
	if (!GITHUB_HOSTS.has(url.hostname)) return undefined;
	const [owner, repo, page] = url.pathname.split("/").filter(Boolean);
	if (!owner || !repo || NON_OWNER_SEGMENTS.has(owner.toLowerCase())) {
		return undefined;
	}
	return {
		// A link to a file, issue, or other page inside a repository is not a
		// link to the repository.
		isRepositoryLink: page === undefined || page === "tree",
		owner,
		repo: repo.replace(/\.git$/, ""),
	};
}
