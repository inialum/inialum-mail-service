import { OpenAPIHono } from '@hono/zod-openapi'

import { sendApiV1 } from './send'
import { sendMultipleApiV1 } from './sendMultiple'
import { sendMultipleSMTPApiV1 } from './sendMultipleSMTP'

export const apiV1 = new OpenAPIHono()
apiV1.route('/send', sendApiV1)
apiV1.route('/send-multiple', sendMultipleApiV1)
apiV1.route('/send-multiple-smtp', sendMultipleSMTPApiV1)
