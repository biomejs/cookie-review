import type { Finding } from "./schema.ts";

interface RightSideHunk {
	lines: Set<number>;
}

export interface LocatedFindings {
	inline: Finding[];
	remaining: Finding[];
}

export function parseRightSideHunks(diff: string): RightSideHunk[] {
	const hunks: RightSideHunk[] = [];
	let current: RightSideHunk | undefined;
	let newLine = 0;

	for (const value of diff.split("\n")) {
		const header = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(value);
		if (header) {
			newLine = Number(header[1]);
			current = { lines: new Set<number>() };
			hunks.push(current);
			continue;
		}

		if (!current || value.startsWith("\\ No newline")) continue;
		if (value.startsWith("+")) {
			current.lines.add(newLine);
			newLine += 1;
		} else if (!value.startsWith("-")) {
			current.lines.add(newLine);
			newLine += 1;
		}
	}

	return hunks;
}

export function locateFindings(
	findings: Finding[],
	diffsByPath: ReadonlyMap<string, string>,
): LocatedFindings {
	const inline: Finding[] = [];
	const remaining: Finding[] = [];

	for (const finding of findings) {
		if (finding.line === null || !isSafeRepositoryPath(finding.path)) {
			remaining.push(finding);
			continue;
		}

		const diff = diffsByPath.get(finding.path);
		const endLine = finding.endLine ?? finding.line;
		const isCommentable =
			diff !== undefined &&
			parseRightSideHunks(diff).some(
				(hunk) =>
					hunk.lines.has(finding.line as number) && hunk.lines.has(endLine),
			);

		if (isCommentable) inline.push(finding);
		else remaining.push(finding);
	}

	return { inline, remaining };
}

export function isSafeRepositoryPath(path: string) {
	return (
		path.length > 0 &&
		!path.startsWith("/") &&
		!path.includes("\\") &&
		!path
			.split("/")
			.some((part) => part === "" || part === "." || part === "..")
	);
}
