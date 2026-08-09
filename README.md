# inialum-mail-service

Microservice for delivering email to users.

## Development

> [!NOTE]
>
> - inialum-mail-service uses [Amazon Simple Email Service (Amazon SES)](https://aws.amazon.com/ses) API v2 to deliver email to users. You need to create an AWS account and configure Amazon SES before using this service in production.
> - This project uses Hono. You can read the documentation [here](https://hono.dev).

### Setup

1. Clone this repository
2. Install dependencies

   ```shell
   pnpm install
   ```

3. Configure environment variables

   ```shell
   cp .dev.vars.example .dev.vars
   ```

   Then, edit `.dev.vars` file and fill the variables with your own values.

4. Run the service

   ```shell
   pnpm run dev
   ```

   The service will be running on port 8080.  
   You can check sended mails at http://localhost:8005. (powered by aws-ses-v2-local)

### Testing

```shell
pnpm run test
```

If you want to run test with coverage report, run this command instead

```shell
pnpm run test:coverage
```

### OpenAPI Specification

OpenAPI Specification (OAS) is a standard, language-agnostic interface to RESTful APIs. This service uses OAS to describe its API and it is powered by [Zod OpenAPI Hono](https://github.com/honojs/middleware/tree/main/packages/zod-openapi). The service hosts the OAS file on `/schema/v1` endpoint.

### Tips

If you want to generate authentication token to request API of this service, you can use this command

```shell
pnpm run create-token
```

The generated token uses `TOKEN_SECRET` (defined in `.dev.vars`) as the secret.

### R2 key migration

The legacy `multiple/...` R2 keys can be migrated with the CLI script below.

```shell
pnpm run migrate:r2-keys -- --env staging
```

This script uses Cloudflare R2's S3-compatible API, so you need:

- `CLOUDFLARE_ACCOUNT_ID`
- `R2_ACCESS_KEY_ID` or `AWS_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY` or `AWS_SECRET_ACCESS_KEY`

Useful options:

- `--apply`: copy objects to the new key structure. Without this, the script runs in dry-run mode.
- `--delete-source`: delete the legacy key after a successful copy. Requires `--apply`.
- `--overwrite`: overwrite an existing target key.
- `--limit 100`: number of legacy objects to process in one run, up to `1000`.
- `--cursor <cursor>`: continue from the cursor returned by the previous run.
- `--bucket <name>`: override the bucket name. By default the script reads `wrangler.json`.

### Investigating bulk-send failures

Bulk send (`POST /api/v1/send-multiple`) writes campaign state and failure evidence to R2 bucket `inialum-mail-service-logs` (`MAIL_LOGS_BUCKET`). Error notification is best-effort only — use R2 (and Workers Observability) as the source of truth.

| What you want | Where to look |
| --- | --- |
| Which recipient finally failed | `{env}/logs/campaigns/failures/{YYYY-MM-DD}/{campaignId}-{recipient}-attempt{N}.json` |
| Campaign totals (sent / failed) | `{env}/state/campaigns/{campaignId}/status.json` |
| Where a chunk stopped | `{env}/state/campaigns/{campaignId}/chunks/{chunkIndex}.json` (`nextRecipientOffset`) + recipients in `manifest.json` |
| Campaign accepted | `{env}/logs/campaigns/accepted/{YYYY-MM-DD}/{campaignId}.json` |

Example failure object key:

```text
production/logs/campaigns/failures/2026-08-09/campaign-1-user_example.com-attempt5.json
```

The JSON includes `to`, `error`, `attempts`, `campaignId`, and `subject`. Final-failure objects may also include `notification_failed`.

How to open objects:

1. Cloudflare Dashboard → R2 → `inialum-mail-service-logs` → browse the prefix above
2. Or CLI:

```shell
pnpm wrangler r2 object get inialum-mail-service-logs/production/logs/campaigns/failures/2026-08-09/<file>.json --file=-
```

Notes:

- A recipient failure log is written only after that recipient exhausts delivery attempts (final SES failure path). Transient retries do not leave a failure object.
- For in-flight errors, check Workers Observability structured logs for the `campaignId` / `recipient` (for example `mail_send_queue.delivery_failed` or `mail_send_queue.invocation_budget_exhausted`).

## Deployment

This service is deployed to [Cloudflare Workers](https://workers.cloudflare.com) using GitHub Actions. When a new commit is pushed to `main` branch, the service will be automatically deployed.  
If you want to deploy to the staging environment, push the commit to `staging` branch. (`@inialum/inialum-dev` will handle this)

## License

Licensed under [Apache License 2.0](LICENSE).
