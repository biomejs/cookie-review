# Cookie Review

Cookie Review runs structured, repository-aware pull request reviews for `biomejs/biome`. A maintainer requests a review by commenting `@biome-cookie review` on a pull request.

The application uses Flue v2, Cloudflare Workers AI, Workflows, Queues, Durable Objects, and Sandbox containers. GitHub is both the ingress channel and review destination.

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
pnpm wrangler queues create cookie-review-dead-letters
pnpm wrangler secret put GITHUB_TOKEN
pnpm wrangler secret put GITHUB_WEBHOOK_SECRET
```

For local development, copy `.env.example` to `.dev.vars` and fill both values. Do not commit `.dev.vars`.

Configure the `biomejs/biome` repository webhook:

- URL: `https://<worker-host>/channels/github/webhook`
- Content type: `application/json`
- Event: Issue comments
- Secret: the same value stored as `GITHUB_WEBHOOK_SECRET`

The GitHub token needs repository metadata read, pull requests read/write, and issues write permissions. Issues write is required for the busy-request reaction.

## Development

```sh
pnpm test
pnpm check:types
pnpm check
pnpm build
```

Cloudflare Sandbox containers are deployed infrastructure and are not exercised by unit tests. Tests use deterministic fakes for GitHub, Queue, Workflow, and coordinator behavior.

## Deploy

```sh
pnpm build
pnpm wrangler deploy --dry-run
pnpm deploy
```

The Worker exposes `GET /health` and the verified GitHub webhook route. The Flue reviewer is dispatch-only and has no public agent route.
