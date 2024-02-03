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

## License

Licensed under [Apache License 2.0](LICENSE).
