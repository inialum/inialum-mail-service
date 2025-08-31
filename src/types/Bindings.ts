import type { EnvironmentType } from '@inialum/error-notification-service-hono-middleware'

export type Bindings = {
	ENVIRONMENT: EnvironmentType
} & CloudflareBindings
