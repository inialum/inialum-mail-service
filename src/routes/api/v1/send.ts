import { OpenAPIHono, createRoute } from '@hono/zod-openapi'
import { env } from 'hono/adapter'

import {
  SendApi400ErrorSchemaV1,
  SendApi500ErrorSchemaV1,
  SendApiRequestSchemaV1,
  SendApiResponseSchemaV1,
} from '@/lib/api/v1/schema/send'
import { sendEmailWithSES } from '@/lib/mail/ses'

const sendApiV1 = new OpenAPIHono()

const route = createRoute({
  method: 'post',
  path: '',
  request: {
    body: {
      content: {
        'application/json': {
          schema: SendApiRequestSchemaV1,
        },
      },
      description: 'Email data to send',
    },
  },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: SendApiResponseSchemaV1,
        },
      },
      description: 'Returns OK response if email is sent successfully',
    },
    400: {
      content: {
        'application/json': {
          schema: SendApi400ErrorSchemaV1,
        },
      },
      description: 'Bad request',
    },
    500: {
      content: {
        'application/json': {
          schema: SendApi500ErrorSchemaV1,
        },
      },
      description: 'Internal server error or external API error',
    },
  },
})

sendApiV1.openapi(
  route,
  async (c) => {
    const { AWS_ACCESS_KEY_ID } = env<{ AWS_ACCESS_KEY_ID: string }>(c)
    const { AWS_SECRET_ACCESS_KEY } = env<{ AWS_SECRET_ACCESS_KEY: string }>(c)
    const data = c.req.valid('json')
    try {
      await sendEmailWithSES(
        {
          fromAddress: 'noreply@notify-test.inialum.org',
          toAddress: data.to,
          subject: data.subject,
          body: data.body,
        },
        {
          accessKeyId: AWS_ACCESS_KEY_ID,
          secretAccessKey: AWS_SECRET_ACCESS_KEY,
        },
      )
      return c.json({
        status: 'ok',
      })
    } catch (e) {
      if (e instanceof Error) {
        //TODO: Use OpenTelemetry for logging
        console.error(e)

        if (e.name === 'SESApiError') {
          console.error(e.message)
        }
        return c.json(
          {
            message: e.message,
          },
          500,
        )
      }
      return c.json(
        {
          message: 'Internal Server Error',
        },
        500,
      )
    }
  },
  (result, c) => {
    if (!result.success) {
      return c.json(
        {
          message: 'Invalid request body',
          issues: result.error.issues,
        },
        400,
      )
    }
  },
)

export { sendApiV1 }
