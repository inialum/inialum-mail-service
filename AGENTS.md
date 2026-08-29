# Development Guide

This file provides guidance for coding agents working in this repository.

## Essential Commands

### Development

- `pnpm run dev` - Start local development (`wrangler dev` on `:8080` + local SES on `:8005`)
- `pnpm run create-token` - Generate JWT token for API testing

### Quality Checks

- `pnpm run lint` - Run Biome checks
- `pnpm run fix` - Apply Biome formatting/fixes
- `pnpm run typecheck` - Run TypeScript type checking
- `pnpm run test` - Run unit tests
- `pnpm run test:coverage` - Run tests with coverage
- `pnpm run db:generate` - Generate D1 migrations from `src/db/schema.ts` (`drizzle-kit generate`)
- `pnpm run db:migrate` - Apply D1 migrations locally
- `pnpm run db:migrate:staging` / `db:migrate:prod` - Apply D1 migrations remotely (CI runs these immediately before Worker deploy)

## Architecture Overview

- Runtime: Cloudflare Workers + Hono
- Deployment: GitHub Actions (`main` branch -> production; staging is manual `workflow_dispatch` on the selected ref)
- Auth: JWT middleware on `/api/*`
- OpenAPI: served at `/schema/v1`
- Plan: Workers Free (external subrequests 50 / invocation)

### Email Delivery Flow

- Production and staging `fetch` handlers use an `aws:ap-northeast-1` Placement Hint to run near SES. Placement does not affect the Queue consumer.
- `POST /api/v1/send`: send a single email via AWS SES (SDK default retries allowed). Optional `Idempotency-Key` enables synchronous D1-backed idempotency through `hono-idempotency` and a thin stale-lock wrapper; its D1 store creates and manages `idempotency_keys` automatically, while a missing key keeps the legacy path. Successful sends are indexed as a `transactional` distribution (`source: send`) with an R2 outcome
- `POST /api/v1/send-multiple`: accept an async campaign (UUID campaign id) and enqueue up to `RECIPIENTS_PER_CHUNK` (40) recipients per queue message. Internally this is one distribution plus one campaign (`kind: transactional`, `source: send-multiple`)
- `POST /api/v1/distributions`: accept a distribution of up to 800 unique recipients (required `Idempotency-Key`). Splits into campaigns of 400, then queue chunks of 40. `marketing` requires `subscriptionKind` and per-recipient `unsubscribeToken`. The queue payload may carry `{ email, unsubscribeToken }` objects; in-flight `string[]` recipients still process
- `GET /api/v1/distributions`, `GET /api/v1/distributions/:id`, `GET /api/v1/distributions/:id/recipients`: history index over D1 (cursor by id descending). Detail includes R2 body manifest
- Queue consumer: `max_batch_size=1`, SES SDK `maxAttempts=1`, paced at `~8/sec` (`SEND_INTERVAL_MS=125`). Queue payload `{ campaignId, chunkIndex, recipients }` may include optional `distributionId`; older in-flight messages still process. After SES, write an immutable R2 outcome then update D1; if D1 fails, ack when an outcome exists and let reconciliation repair the index. `enqueue: true` also sends a `{ type: 'watchdog', distributionId }` message delayed `WATCHDOG_DELAY_SECONDS` (300). The consumer inspects D1 `sent_recipients` and `MAIL_SEND_DLQ.metrics().backlogCount`, notifies once per stall / DLQ backlog, and reschedules until the distribution is terminal and the DLQ is empty
- Marketing send only: replace `{{unsubscribeToken}}` in HTML/text immediately before SES, and set SES v2 `Content.Simple.Headers` `List-Unsubscribe` / `List-Unsubscribe-Post` (`List-Unsubscribe=One-Click`) using `UNSUBSCRIBE_BASE_URL`. Missing placeholder logs `mail_send_queue.unsubscribe_placeholder_missing` and still sends. Transactional mail is not rewritten and gets no unsubscribe headers. mail-service never holds the HMAC key; it only substitutes opaque tokens
- Retry policy: recipient-level continuation messages; invocation budget exhaustion retries the same queue message without consuming recipient attempts, preserving `max_retries` and moving exhausted messages to the failed-message holding queue (Dead Letter Queue, DLQ)
- Free budget note: size sends as `batch × chunk × SES maxAttempts` and keep headroom for best-effort error notification. Do not enable SES SDK retries on the consumer while staying on Free
- `scheduled` cron `0 17 * * *` (JST 02:00): reconcile R2 outcomes into D1, legacy bulk backfill (`source: legacy-bulk`; `BACKFILL_DRY_RUN` defaults to `"true"` and only logs), 1-year retention deletes, and `idempotency_keys` `store.purge()`. Staging cron reads only `inialum-mail-service-logs-staging`

### Storage and Logging

- R2 bucket binding: `MAIL_LOGS_BUCKET`
  - production: `inialum-mail-service-logs`
  - staging: `inialum-mail-service-logs-staging` (do not run backfill against production from staging)
- D1 binding: `DB` (`inialum-mail-db` / `-staging`)
  - `idempotency_keys` remains library-managed by `hono-idempotency` (not in the Drizzle schema)
  - History tables `distributions` / `campaigns` / `recipients` are owned by Drizzle (`src/db/schema.ts`). Change the schema, run `pnpm run db:generate`, then migrate. Do not hand-edit generated SQL. Runtime reads/writes use the Drizzle query builder only
- Campaign acceptance logs and recipient failure logs are stored as JSON
- Additional history objects:
  - Distribution body/audience: `{env}/state/distributions/{distributionId}/manifest.json`
  - Immutable recipient outcomes: `{env}/outcomes/{campaignId}/{recipientId}.json`
- Ops lookup paths (see README "Investigating bulk-send failures"):
  - Final recipient failures: `{env}/logs/campaigns/failures/{date}/{campaignId}-{recipient}-attempt{N}.json`
  - Campaign status / chunk progress: `{env}/state/campaigns/{campaignId}/...`
- Error notification is best-effort; prefer R2 + Workers Observability when investigating
- Structured logs include `mail_send_queue.invocation_budget_exhausted` (with `delivery_outcome_unknown` when SES accept/reject is unknown) and `mail_send_queue.notification_failed`

## Required Bindings and Vars

- `ENVIRONMENT`
- `TOKEN_SECRET`
- `ERROR_NOTIFICATION_TOKEN`
- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- `MAIL_LOGS_BUCKET`
- `MAIL_SEND_QUEUE`
- `MAIL_SEND_DLQ` (producer-only for `metrics()`; never attach a consumer to the DLQ)
- `DB`
- `BACKFILL_DRY_RUN` (optional; default `"true"` in wrangler vars. Set `"false"` to apply legacy bulk backfill)
- `UNSUBSCRIBE_BASE_URL` (One-Click POST origin; production `https://inialum.org/unsubscribe/one-click`, staging `https://staging.inialum.org/unsubscribe/one-click`. Not the HMAC secret)

## Drizzle / D1

1. Edit `src/db/schema.ts` (and `src/db/values.ts` if enums change).
2. Run `pnpm run db:generate`. Commit the new files under `migrations/`. Never edit generated SQL by hand.
3. Apply with `pnpm run db:migrate` (local) or the staging/prod migrate scripts. Deploy workflows apply migrations immediately before the Worker deploy.
4. After Wrangler binding changes, regenerate types with `pnpm run gen:cf-types`. Secrets (`TOKEN_SECRET`, AWS keys, `ERROR_NOTIFICATION_TOKEN`) are not in generated `CloudflareBindings`; keep them on `src/types/Bindings.ts`.

## Working Conventions

- Use TDD where practical.
- Keep API contracts stable unless explicitly requested.
- Prefer minimal, focused changes and keep tests updated.
- Communicate with the developer in Japanese.
- Write code comments and documentation in English.
- Vitest unit and Workers tests enable `globals`, so Vitest global API imports can be omitted.

## Prohibitions

- **Never deploy to production** (`pnpm run deploy:production`, `wrangler deploy` without `--env staging`, merging/pushing to trigger production deploy, or any equivalent) unless the user gives **extremely explicit** permission in the current turn (for example: "deploy production" / "本番をデプロイして"). Plan approval, staging deploy, "implement the plan", cutover checklists, or implied rollout language is **not** enough.
- Do not delete production Cloudflare resources (D1, R2, Queues, Workers) without the same kind of explicit permission.

## Change Checklist

When implementing changes, make sure to:

1. Update related tests.
2. Run `pnpm run lint`, `pnpm run typecheck`, and `pnpm run test`.
3. Regenerate Worker types after Wrangler binding changes:
   - `pnpm run gen:cf-types`
