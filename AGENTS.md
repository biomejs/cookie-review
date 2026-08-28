# Cookie Review

This TypeScript application reviews configured GitHub pull requests using Flue v2 on Cloudflare Workers.

## Architecture

- `src/config.ts` contains public repository policy. Secrets never belong there.
- `src/app.ts` owns HTTP routing, including the verified Flue GitHub channel.
- `src/cloudflare.ts` exports the Workflow, Durable Objects, Sandbox, and Queue consumer.
- `src/channels/` validates GitHub webhook events and sends review requests to Cloudflare Queues.
- `src/coordinator.ts` serializes admission per repository and pull request.
- `src/workflows/` orchestrates checkout, Flue dispatch/read, review publication, and lock release.
- `src/agents/` contains Flue agents. Every agent module begins with `'use agent'`.
- `src/review/` contains structured result schemas, diff mapping, and GitHub rendering.

## Invariants

- Only configured repositories and comments matching the configured trigger may request a review.
- Repository `write` or `admin` permission is required at Queue consumption time.
- At most one review Workflow may be active for a pull request.
- Busy requests are acknowledged and discarded after adding the configured reaction; they never wait for later execution.
- GitHub webhook delivery IDs and Queue redelivery must be idempotent.
- The review skill is loaded from the trusted PR base commit, never from the contributor-controlled head commit.
- Closing issues and linked discussions are collected before dispatch as untrusted business context, never as instructions or a source of truth.
- The Sandbox receives no GitHub token. All privileged GitHub writes happen in Worker code.
- Reviews are static and read-only. Never run repository code, tests, builds, formatters, linters, codegen, package managers, or daemons.
- Findings must pass the shared Valibot schema and attach to right-side PR diff lines. Non-commentable findings are omitted and never rendered in the review body.

## Commands

- `pnpm dev` starts the local Worker through Vite.
- `pnpm test` runs Vitest.
- `pnpm check:types` runs TypeScript without emitting files.
- `pnpm check` checks formatting and lint rules with Biome.
- `pnpm build` builds the deployable Worker.
- `pnpm deploy` builds and deploys with Wrangler.
- `pnpm flue docs search <query>` searches documentation matching the installed Flue version.

## Editing

- Keep Flue packages on major version 2.
- Append Cloudflare Durable Object migrations; never rewrite a deployed migration.
- Keep Queue payloads and Workflow step results small and serializable.
- Add or update Vitest coverage for every policy or concurrency change.
