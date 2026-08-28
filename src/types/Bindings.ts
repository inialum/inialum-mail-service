import type { EnvironmentType } from '@inialum/error-notification-service-hono-middleware'

export type Bindings = Omit<
	CloudflareBindings,
	'BACKFILL_DRY_RUN' | 'ENVIRONMENT'
> & {
	ENVIRONMENT: EnvironmentType
	BACKFILL_DRY_RUN?: string
	TOKEN_SECRET: string
	ERROR_NOTIFICATION_TOKEN: string
	AWS_ACCESS_KEY_ID: string
	AWS_SECRET_ACCESS_KEY: string
}
