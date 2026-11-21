import * as v from "valibot";
import { describe, expect, it, vi } from "vitest";
import {
	detectBugReport,
	detectReproduction,
} from "../src/triage/heuristics.ts";
import { processIssueTriageRequest } from "../src/triage/process.ts";
import {
	type CommentSnapshot,
	type IssueSnapshot,
	type IssueTriageRequest,
	issueTriageRequestSchema,
} from "../src/triage/request.ts";

const request: IssueTriageRequest = {
	deliveryId: "delivery-1",
	event: "opened",
	issueNumber: 456,
	repository: "biomejs/biome",
};
const editedRequest: IssueTriageRequest = { ...request, event: "edited" };
const commentedRequest: IssueTriageRequest = {
	...request,
	commentId: 789,
	event: "commented",
};
const bugPolicy = {
	bugIssueTypes: ["Bug"],
	bugTemplateHeading: "Environment information",
};
const linkPolicy = {
	owner: "biomejs",
	playgroundUrl: "https://biomejs.dev/playground",
};
const playgroundLink =
	"https://biomejs.dev/playground/?lintRules=all#code=YQBiAGMA";

describe("bug report detection", () => {
	it("trusts the issue type when one is set", () => {
		expect(detectBugReport({ body: "", type: "Bug" }, bugPolicy)).toBe("yes");
		expect(
			detectBugReport(
				{ body: "### Environment information", type: "Task" },
				bugPolicy,
			),
		).toBe("no");
	});

	it("recognizes the bug template of an untyped issue", () => {
		expect(
			detectBugReport(
				{
					body: "### Environment information\n\nCLI: 2.5.14",
					type: undefined,
				},
				bugPolicy,
			),
		).toBe("yes");
		expect(
			detectBugReport(
				{ body: "The formatter crashes on this file.", type: undefined },
				bugPolicy,
			),
		).toBe("unknown");
	});
});

describe("reproduction detection", () => {
	it("accepts a playground link that carries shared state", () => {
		expect(
			detectReproduction(`### Playground link\n\n${playgroundLink}`, linkPolicy)
				.verdict,
		).toBe("yes");
		expect(
			detectReproduction(`See [the playground](${playgroundLink}).`, linkPolicy)
				.verdict,
		).toBe("yes");
		expect(
			detectReproduction(
				"https://next.biomejs.dev/playground/?lintRules=all#code=YQBiAGMA",
				linkPolicy,
			).verdict,
		).toBe("yes");
		expect(
			detectReproduction(
				"https://notbiomejs.dev/playground/?lintRules=all#code=YQBiAGMA",
				linkPolicy,
			).verdict,
		).toBe("no");
	});

	it("rejects the bare playground placeholder", () => {
		for (const body of [
			"https://biomejs.dev/playground/",
			"https://biomejs.dev/playground/...",
			"I could not get https://biomejs.dev/playground to load.",
		]) {
			expect(detectReproduction(body, linkPolicy).verdict).toBe("no");
		}
	});

	it("accepts a repository named as a reproduction", () => {
		expect(
			detectReproduction(
				"Repo: https://github.com/reporter/biome-repro-1234.",
				linkPolicy,
			).verdict,
		).toBe("yes");
	});

	it("ignores links that cannot be a reproduction repository", () => {
		const body = [
			"https://github.com/biomejs/biome/blob/main/CODE_OF_CONDUCT.md",
			"https://github.com/user-attachments/assets/0f0e1d2c",
			"https://github.com/vitejs/vite/issues/1234",
			"https://github.com/reporter/my-app/blob/main/src/a.ts",
			"https://github.com/reporter",
			"https://example.com/reporter/project",
		].join("\n");
		expect(detectReproduction(body, linkPolicy)).toEqual({
			candidates: [],
			verdict: "no",
		});
	});

	it("leaves other repository links for the model to judge", () => {
		expect(
			detectReproduction(
				"It happens in https://github.com/reporter/my-app, see https://github.com/reporter/my-app/tree/broken and again https://github.com/reporter/my-app.",
				linkPolicy,
			),
		).toEqual({
			candidates: [
				"https://github.com/reporter/my-app",
				"https://github.com/reporter/my-app/tree/broken",
			],
			verdict: "unknown",
		});
	});
});

describe("issue triage processing", () => {
	it("labels a typed bug report without links and without asking the model", async () => {
		const services = createServices(issue());

		expect(await processIssueTriageRequest(request, services)).toBe("labeled");
		expect(services.ask).not.toHaveBeenCalled();
		expect(services.addLabel).toHaveBeenCalledExactlyOnceWith(
			request,
			"S-Needs repro",
		);
	});

	it("skips issues that need no decision", async () => {
		for (const [snapshot, outcome] of [
			[undefined, "ignored"],
			[issue({ isPullRequest: true }), "ignored"],
			[issue({ state: "closed" }), "ignored"],
			[issue({ labels: ["S-Needs repro"] }), "ignored"],
			[issue({ authorAssociation: "MEMBER" }), "ignored"],
			[issue({ type: "Task" }), "not-bug"],
			[issue({ body: playgroundLink }), "has-reproduction"],
			[issue({ body: playgroundLink, type: undefined }), "has-reproduction"],
		] as const) {
			const services = createServices(snapshot);

			expect(await processIssueTriageRequest(request, services)).toBe(outcome);
			expect(services.ask).not.toHaveBeenCalled();
			expect(services.addLabel).not.toHaveBeenCalled();
		}
	});

	it("ignores unconfigured repositories before reading the issue", async () => {
		const services = createServices(issue());

		expect(
			await processIssueTriageRequest(
				{ ...request, repository: "other/repository" },
				services,
			),
		).toBe("ignored");
		expect(services.getIssue).not.toHaveBeenCalled();
	});

	it("asks the model only what the heuristics could not decide", async () => {
		const untyped = createServices(
			issue({ body: "It crashes.", type: undefined }),
			{ isBugReport: 0.93 },
		);
		expect(await processIssueTriageRequest(request, untyped)).toBe("labeled");
		expect(untyped.ask).toHaveBeenCalledExactlyOnceWith("typesafe/jev", {
			questions: { isBugReport: expect.objectContaining({ type: "noul" }) },
			state: {
				body: "It crashes.",
				links: [],
				playgroundUrl: "https://biomejs.dev/playground",
				title: "Formatter crash",
			},
		});

		const linked = createServices(
			issue({ body: "See https://github.com/reporter/my-app" }),
			{ hasReproduction: 0.04 },
		);
		expect(await processIssueTriageRequest(request, linked)).toBe("labeled");
		expect(linked.ask).toHaveBeenCalledExactlyOnceWith("typesafe/jev", {
			questions: {
				hasReproduction: expect.objectContaining({ type: "noul" }),
			},
			state: expect.objectContaining({
				links: ["https://github.com/reporter/my-app"],
			}),
		});
	});

	it("labels only when the model is confident", async () => {
		const body = "Broken with https://github.com/reporter/my-app";
		for (const [answers, outcome] of [
			[{ hasReproduction: 0.1, isBugReport: 0.9 }, "labeled"],
			[{ hasReproduction: 0.1, isBugReport: 0.2 }, "not-bug"],
			[{ hasReproduction: 0.9, isBugReport: 0.9 }, "has-reproduction"],
			[{ hasReproduction: 0.5, isBugReport: 0.9 }, "uncertain"],
			[{ hasReproduction: 0.1, isBugReport: 0.5 }, "uncertain"],
		] as const) {
			const services = createServices(
				issue({ body, type: undefined }),
				answers,
			);

			expect(await processIssueTriageRequest(request, services)).toBe(outcome);
			expect(services.addLabel).toHaveBeenCalledTimes(
				outcome === "labeled" ? 1 : 0,
			);
		}
	});

	it("fails without labeling when the model response is unusable", async () => {
		for (const response of [
			{},
			{ answers: {} },
			{ answers: { isBugReport: { noul: 7, type: "noul" } } },
		]) {
			const services = createServices(
				issue({ body: "It crashes.", type: undefined }),
			);
			services.ask.mockResolvedValue(response);

			await expect(
				processIssueTriageRequest(request, services),
			).rejects.toThrow();
			expect(services.addLabel).not.toHaveBeenCalled();
		}
	});
});

describe("issue triage request schema", () => {
	it("reads requests enqueued before the event field as opened issues", () => {
		expect(
			v.parse(issueTriageRequestSchema, {
				deliveryId: "delivery-1",
				issueNumber: 456,
				repository: "biomejs/biome",
			}),
		).toEqual(request);
	});

	it("requires a comment ID for comment rechecks", () => {
		expect(
			v.safeParse(issueTriageRequestSchema, { ...request, event: "commented" })
				.success,
		).toBe(false);
		expect(v.parse(issueTriageRequestSchema, commentedRequest)).toEqual(
			commentedRequest,
		);
	});
});

describe("reproduction recheck", () => {
	const awaiting = { labels: ["S-Needs repro"] };

	it("returns an edited issue that now links a playground to triage", async () => {
		const services = createServices(
			issue({ ...awaiting, body: `Repro: ${playgroundLink}` }),
		);

		expect(await processIssueTriageRequest(editedRequest, services)).toBe(
			"retriaged",
		);
		expect(services.ask).not.toHaveBeenCalled();
		expect(services.getComment).not.toHaveBeenCalled();
		expect(services.addLabel).toHaveBeenCalledExactlyOnceWith(
			editedRequest,
			"S-Needs triage",
		);
		expect(services.removeLabel).toHaveBeenCalledExactlyOnceWith(
			editedRequest,
			"S-Needs repro",
		);
	});

	it("returns an issue to triage when a comment links a reproduction", async () => {
		const services = createServices(
			issue(awaiting),
			{},
			{
				authorAssociation: "NONE",
				body: "Here: https://github.com/reporter/biome-repro",
			},
		);

		expect(await processIssueTriageRequest(commentedRequest, services)).toBe(
			"retriaged",
		);
		expect(services.getComment).toHaveBeenCalledExactlyOnceWith(
			commentedRequest,
			789,
		);
		expect(services.addLabel).toHaveBeenCalledExactlyOnceWith(
			commentedRequest,
			"S-Needs triage",
		);
		expect(services.removeLabel).toHaveBeenCalledExactlyOnceWith(
			commentedRequest,
			"S-Needs repro",
		);
	});

	it("finishes a partially applied label swap on redelivery", async () => {
		const services = createServices(
			issue({
				body: playgroundLink,
				labels: ["S-Needs repro", "S-Needs triage"],
			}),
		);

		expect(await processIssueTriageRequest(editedRequest, services)).toBe(
			"retriaged",
		);
		expect(services.removeLabel).toHaveBeenCalledExactlyOnceWith(
			editedRequest,
			"S-Needs repro",
		);
	});

	it("adds the triage label before removing the reproduction label", async () => {
		const services = createServices(
			issue({ ...awaiting, body: playgroundLink }),
		);
		services.addLabel.mockRejectedValueOnce(new Error("GitHub unavailable"));

		await expect(
			processIssueTriageRequest(editedRequest, services),
		).rejects.toThrow();
		expect(services.removeLabel).not.toHaveBeenCalled();
	});

	it("judges the comment's links, not the issue body's", async () => {
		const services = createServices(
			issue({ ...awaiting, body: playgroundLink }),
			{},
			{ authorAssociation: "NONE", body: "Still broken on 2.5.15." },
		);

		expect(await processIssueTriageRequest(commentedRequest, services)).toBe(
			"no-reproduction",
		);
		expect(services.addLabel).not.toHaveBeenCalled();
		expect(services.removeLabel).not.toHaveBeenCalled();
	});

	it("skips issues and comments that need no recheck", async () => {
		const outsider = { authorAssociation: "NONE", body: playgroundLink };
		for (const [triageRequest, snapshot, comment] of [
			[editedRequest, undefined, undefined],
			[editedRequest, issue({ body: playgroundLink }), undefined],
			[
				editedRequest,
				issue({ ...awaiting, body: playgroundLink, state: "closed" }),
				undefined,
			],
			[
				editedRequest,
				issue({ ...awaiting, body: playgroundLink, isPullRequest: true }),
				undefined,
			],
			[
				editedRequest,
				issue({
					...awaiting,
					authorAssociation: "MEMBER",
					body: playgroundLink,
				}),
				undefined,
			],
			[commentedRequest, issue(awaiting), undefined],
			[
				commentedRequest,
				issue(awaiting),
				{ ...outsider, authorAssociation: "OWNER" },
			],
			[commentedRequest, issue({ labels: [] }), outsider],
		] as const) {
			const services = createServices(snapshot, {}, comment);

			expect(await processIssueTriageRequest(triageRequest, services)).toBe(
				"ignored",
			);
			expect(services.ask).not.toHaveBeenCalled();
			expect(services.addLabel).not.toHaveBeenCalled();
		}
	});

	it("asks the model only about undecided repository links", async () => {
		const comment = {
			authorAssociation: "CONTRIBUTOR",
			body: "Reproduced in https://github.com/reporter/my-app",
		};
		for (const [noul, outcome] of [
			[0.9, "retriaged"],
			[0.5, "uncertain"],
			[0.1, "no-reproduction"],
		] as const) {
			const services = createServices(
				issue(awaiting),
				{ hasReproduction: noul },
				comment,
			);

			expect(await processIssueTriageRequest(commentedRequest, services)).toBe(
				outcome,
			);
			expect(services.ask).toHaveBeenCalledExactlyOnceWith("typesafe/jev", {
				questions: {
					hasReproduction: expect.objectContaining({ type: "noul" }),
				},
				state: {
					body: "### Environment information\n\nCLI: 2.5.14",
					comment: comment.body,
					links: ["https://github.com/reporter/my-app"],
					playgroundUrl: "https://biomejs.dev/playground",
					title: "Formatter crash",
				},
			});
			expect(services.addLabel).toHaveBeenCalledTimes(
				outcome === "retriaged" ? 1 : 0,
			);
			expect(services.removeLabel).toHaveBeenCalledTimes(
				outcome === "retriaged" ? 1 : 0,
			);
		}
	});
});

function issue(overrides: Partial<IssueSnapshot> = {}): IssueSnapshot {
	return {
		authorAssociation: "NONE",
		body: "### Environment information\n\nCLI: 2.5.14",
		isPullRequest: false,
		labels: ["S-Needs triage"],
		state: "open",
		title: "Formatter crash",
		type: "Bug",
		...overrides,
	};
}

function createServices(
	snapshot: IssueSnapshot | undefined,
	answers: Record<string, number> = {},
	comment?: CommentSnapshot,
) {
	return {
		addLabel: vi.fn(async () => {}),
		ask: vi.fn(
			async (): Promise<unknown> => ({
				answers: Object.fromEntries(
					Object.entries(answers).map(([question, noul]) => [
						question,
						{ noul, type: "noul" },
					]),
				),
				model: "jev-1.13.0",
			}),
		),
		getComment: vi.fn(async () => comment),
		getIssue: vi.fn(async () => snapshot),
		removeLabel: vi.fn(async () => {}),
	};
}
