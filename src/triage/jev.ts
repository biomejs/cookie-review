import * as v from "valibot";

const MAX_BODY_CHARACTERS = 12_000;
const MAX_LINKS = 20;

const QUESTIONS = {
	hasReproduction: {
		criteria: {
			false:
				"The links only point at the author's own project, other projects, or dependencies",
			true: "At least one link is a playground link sharing code, or a repository set up to reproduce the problem",
		},
		instructions:
			"Does the issue link to a minimal reproduction of the problem described in `body`: either a link to the playground at `playgroundUrl`, or a GitHub repository from `links`?",
		type: "noul",
	},
	isBugReport: {
		criteria: {
			false:
				"A feature request, question, support request, task, or anything else",
			true: "Reports incorrect, broken, or regressed behavior of the software",
		},
		instructions: "Is this GitHub issue a bug report?",
		type: "noul",
	},
} as const;

export type TriageQuestion = keyof typeof QUESTIONS;

const jevResponseSchema = v.object({
	answers: v.record(
		v.string(),
		v.object({ noul: v.pipe(v.number(), v.minValue(0), v.maxValue(1)) }),
	),
});

// The issue is untrusted input. Jev only scores it against the fixed questions
// below, and its answers are bounded probabilities.
export function buildJevInput(input: {
	issue: { body: string; title: string };
	links: readonly string[];
	playgroundUrl: string;
	questions: readonly TriageQuestion[];
}) {
	return {
		questions: Object.fromEntries(
			input.questions.map((question) => [question, QUESTIONS[question]]),
		),
		state: {
			body: input.issue.body.slice(0, MAX_BODY_CHARACTERS),
			links: input.links.slice(0, MAX_LINKS),
			playgroundUrl: input.playgroundUrl,
			title: input.issue.title,
		},
	};
}

export function readJevProbability(
	response: unknown,
	question: TriageQuestion,
) {
	const answer = v.parse(jevResponseSchema, response).answers[question];
	if (!answer) throw new Error(`Jev did not answer ${question}`);
	return answer.noul;
}
