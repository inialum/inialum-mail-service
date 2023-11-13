import { OpenAPIHono } from '@hono/zod-openapi'

import { sendApiV1 } from './send'

export const apiV1 = new OpenAPIHono()
apiV1.route('/send', sendApiV1)
