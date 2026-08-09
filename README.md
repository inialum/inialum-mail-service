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

OpenAPI Specification (OAS) is a standard, language-agnostic interface to RESTful APIs. This service uses OAS to describe its API and it is powered by [Zod OpenAPI Hono
](https://github.com/honojs/middleware/tree/main/packages/zod-openapi). The service hosts the OAS file on `/schema/v1` endpoint.

### Tips

If you want to generate authentication token to request API of this service, you can use this command

```shell
pnpm run create-token
```

The generated token uses `TOKEN_SECRET` (defined in `.dev.vars`) as the secret.

## Deployment

This service is deployed to [Cloudflare Workers](https://workers.cloudflare.com) using GitHub Actions. When a new commit is pushed to `main` branch, the service will be automatically deployed.  
If you want to deploy to the staging environment, push the commit to `staging` branch. (`@inialum/inialum-dev` will handle this)

### Workers Free delivery constraints

INIALUM runs on Workers Free. Bulk send (`POST /api/v1/send-multiple`) must stay within the external subrequest limit (50 / invocation):

- Queue consumer `max_batch_size`: **1**
- Recipients per queue message (`RECIPIENTS_PER_CHUNK`): **40**
- Queue consumer SES SDK `maxAttempts`: **1** (no automatic SDK retries)
- Single-send `POST /api/v1/send` keeps the SDK default retry contract

A Dead Letter Queue (DLQ) holds messages that still fail after all retries, so they can be investigated or manually retried instead of being retried forever.

If Observability shows `Too many subrequests`, the consumer retries the same queue message without consuming recipient attempts and logs `invocation_budget_exhausted`. Queue `max_retries` remains effective, and after all retries the campaign is marked failed and the message is moved to the DLQ. When SES accept/reject is unknown, logs include `delivery_outcome_unknown: true` (a later retry may duplicate delivery).

Queue daily ops are counted per queue message write/read/delete (and retry reads), not per recipient.

## License

Licensed under [Apache License 2.0](LICENSE).
