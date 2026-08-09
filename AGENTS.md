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

## Architecture Overview

- Runtime: Cloudflare Workers + Hono
- Deployment: GitHub Actions (`staging` branch -> staging, `main` branch -> production)
- Auth: JWT middleware on `/api/*`
- OpenAPI: served at `/schema/v1`
- Plan: Workers Free (external subrequests 50 / invocation)

### Email Delivery Flow

- `POST /api/v1/send`: send a single email via AWS SES (SDK default retries allowed)
- `POST /api/v1/send-multiple`: accept an async campaign and enqueue up to `RECIPIENTS_PER_CHUNK` (40) recipients per queue message
- Queue consumer: `max_batch_size=1`, SES SDK `maxAttempts=1`, paced at `~8/sec` (`SEND_INTERVAL_MS=125`)
- Retry policy: recipient-level requeue with DLQ fallback; invocation budget exhaustion requeues without consuming recipient attempts
- Free budget note: size sends as `batch × chunk × SES maxAttempts` and keep headroom for best-effort error notification. Do not enable SES SDK retries on the consumer while staying on Free

### Storage and Logging

- R2 bucket binding: `MAIL_LOGS_BUCKET`
- Campaign acceptance logs and recipient failure logs are stored as JSON
- Structured logs include `mail_send_queue.invocation_budget_exhausted` (with `delivery_outcome_unknown` when SES accept/reject is unknown) and `mail_send_queue.notification_failed`

## Required Bindings and Vars

- `ENVIRONMENT`
- `TOKEN_SECRET`
- `ERROR_NOTIFICATION_TOKEN`
- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- `MAIL_LOGS_BUCKET`
- `MAIL_SEND_QUEUE`

## Working Conventions

- Use TDD where practical.
- Keep API contracts stable unless explicitly requested.
- Prefer minimal, focused changes and keep tests updated.
- Communicate with the developer in Japanese.
- Write code comments and documentation in English.

## Change Checklist

When implementing changes, make sure to:

1. Update related tests.
2. Run `pnpm run lint`, `pnpm run typecheck`, and `pnpm run test`.
3. Regenerate Worker types after Wrangler binding changes:
   - `pnpm run gen:cf-types`
