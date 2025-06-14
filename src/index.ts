import { OpenAPIHono } from '@hono/zod-openapi'
import { env } from 'hono/adapter'
import { cors } from 'hono/cors'
import { jwt } from 'hono/jwt'
import { secureHeaders } from 'hono/secure-headers'

import { API_ENDPOINT, ORIGINS } from './constants/config'

import { api } from './routes/api'

import { notifyError } from '@inialum/error-notification-service-hono-middleware'
import type { Bindings } from './types/Bindings'

const app = new OpenAPIHono<{ Bindings: Bindings }>()

app.use('*', secureHeaders())

app.use('*', async (c, next) => {
	const { ENVIRONMENT, ERROR_NOTIFICATION_TOKEN } = env(c)

	const handleError = notifyError({
		token: ERROR_NOTIFICATION_TOKEN,
		serviceName: 'inialum-mail-service',
		environment: ENVIRONMENT,
		beforeSend(error) {
			// Ignore errors with no authorization included in request
			if (error.message.includes('no authorization included in request')) {
				return false
			}
		},
	})

	return await handleError(c, next)
})

app.use('/api/*', async (c, next) => {
	const { ENVIRONMENT } = env(c)

	const originCheck = cors({
		origin: ENVIRONMENT === 'production' ? ORIGINS : '*',
	})

	return await originCheck(c, next)
})

app.use('/api/*', async (c, next) => {
	const { TOKEN_SECRET } = env(c)

	const auth = jwt({
		secret: TOKEN_SECRET,
	})

	return await auth(c, next)
})

app.route('/api', api)

app.doc('/schema/v1', {
	openapi: '3.0.0',
	info: {
		version: '1.0.0',
		title: 'INIALUM Mail Service API v1',
	},
	servers: [
		{
			url: API_ENDPOINT,
		},
	],
})

app.openAPIRegistry.registerComponent('securitySchemes', 'bearerAuth', {
	type: 'http',
	scheme: 'bearer',
	bearerFormat: 'JWT',
	description: 'JWT Authentication',
})

export default app
