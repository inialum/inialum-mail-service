import type { EnvironmentType } from '@inialum/error-notification-service-hono-middleware'

export type Bindings = {
	ENVIRONMENT: EnvironmentType
	// SMTP configuration
	SMTP_HOST?: string
	SMTP_PORT?: string
	SMTP_USER?: string
	SMTP_PASS?: string
} & CloudflareBindings
