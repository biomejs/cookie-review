# Cookie Review

Cookie Review runs structured, repository-aware pull request reviews for `biomejs/biome`. A maintainer requests a review by commenting `@biome-cookie review` on a pull request.

Cookie Review also triages newly opened issues: a bug report from outside the `biomejs` organization that links neither a playground nor a reproduction repository receives the `S-Needs repro` label.

The application uses Flue v2, Cloudflare Workers AI, Workflows, Queues, Durable Objects, and Sandbox containers. GitHub is both the ingress channel and review destination. Review analysis is read-only; directly applicable suggested changes are checked in a separate tokenless Rust verification sandbox before publication.

## Setup

Requirements:

- Node.js 22.19 or newer
- pnpm 10.11.1
- A Cloudflare Workers Paid account with Containers access
- A fine-grained token for `biome-cookie`

```sh
pnpm install
pnpm wrangler login
pnpm wrangler queues create cookie-review-requests
pnpm wrangler queues create cookie-review-issue-triage
pnpm wrangler queues create cookie-review-dead-letters
pnpm wrangler secret put GITHUB_TOKEN
pnpm wrangler secret put GITHUB_WEBHOOK_SECRET
```

For local development, copy `.env.example` to `.dev.vars` and fill both values. Do not commit `.dev.vars`.

Configure the `biomejs/biome` repository webhook:

- URL: `https://<worker-host>/channels/github/webhook`
- Content type: `application/json`
- Events: Issue comments, Issues
- Secret: the same value stored as `GITHUB_WEBHOOK_SECRET`

The GitHub token needs repository metadata read, discussions read, pull requests read/write, and issues write permissions. Discussions read is required for linked business context; issues write is required for the busy-request reaction and for labeling triaged issues.

## Development

```sh
pnpm test
pnpm check:types
pnpm check
pnpm build
```

Cloudflare Sandbox containers are deployed infrastructure and are not exercised by unit tests. Tests use deterministic fakes for GitHub, Queue, Workflow, and coordinator behavior.

The analysis container stays read-only. A verification container is created lazily only when the reviewer has candidate suggestions. It checks out the public pull request head, fetches locked Cargo dependencies, and disables network access. Non-overlapping suggestions that share a crate and command are applied as one batch before a single package-scoped `cargo check`, `cargo test`, or `cargo clippy` run. Whole-workspace commands are not available. A passing batch receives one bound receipt per suggestion; suggestions from failing batches are omitted while their findings remain.

Issue triage runs in the Queue consumer without a Sandbox. The issue type, the bug report template, and the links in the issue body settle most issues directly. Only what they leave undecided is put to TypeSafe's Jev decision model through the Workers AI binding, and the label is applied only when its answers clear the configured confidence. Applying the label is the only write: the `biomejs/biome` `needs-repro.yml` workflow then posts the reproduction request, and its stale-issue job closes the issue after three days without activity.

The verification image pins the Rust toolchain expected by the configured repository. Build it locally with:

```sh
docker build -f Dockerfile.verification -t cookie-review-verification .
```

## Deploy

The Workers Builds API token needs account-level Workers Scripts Edit and Containers Edit permissions.

```sh
pnpm build
pnpm wrangler deploy --dry-run
pnpm run deploy
```

The Worker exposes `GET /health` and the verified GitHub webhook route. The Flue reviewer is dispatch-only and has no public agent route.
