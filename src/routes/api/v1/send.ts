import { OpenAPIHono, createRoute } from '@hono/zod-openapi'
import { env } from 'hono/adapter'

import { LOCAL_SES_API_ENDPOINT } from '@/constants/mail'

import {
  SendApi400ErrorSchemaV1,
  SendApi500ErrorSchemaV1,
  SendApiRequestSchemaV1,
  SendApiResponseSchemaV1,
} from '@/libs/api/v1/schema/send'
import { SESApiError } from '@/libs/error/applicationErrors'
import { notifyError } from '@/libs/error/notification/notify'
import { sendEmailWithSES } from '@/libs/mail/ses'

import type { EnvironmentType } from '@/types/Environment'

const sendApiV1 = new OpenAPIHono()

const route = createRoute({
  method: 'post',
  path: '',
  security: [{ Bearer: [] }],
  request: {
    body: {
      content: {
        'application/json': {
          schema: SendApiRequestSchemaV1,
        },
      },
      description: 'Email data to send',
      required: true,
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
    const { ENVIRONMENT } = env<{ ENVIRONMENT: EnvironmentType }>(c)
    const { ERROR_NOTIFICATION_TOKEN } = env<{
      ERROR_NOTIFICATION_TOKEN: string
    }>(c)

    const data = c.req.valid('json')

    try {
      await sendEmailWithSES(
        {
          fromAddress: data.from,
          toAddresses: [data.to],
          subject: data.subject,
          body: data.body,
        },
        {
          accessKeyId: AWS_ACCESS_KEY_ID,
          secretAccessKey: AWS_SECRET_ACCESS_KEY,
        },
        ENVIRONMENT === 'production' || ENVIRONMENT === 'staging'
          ? undefined
          : LOCAL_SES_API_ENDPOINT,
      )
      return c.json({
        status: 'ok',
      })
    } catch (e) {
      if (e instanceof Error) {
        await notifyError(
          {
            title: e.name,
            description: e.message,
            environment: ENVIRONMENT,
          },
          ERROR_NOTIFICATION_TOKEN,
        )

        if (e instanceof SESApiError) {
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
      /*
      TODO: Enable later

      const { ENVIRONMENT } = env<{ ENVIRONMENT: EnvironmentType }>(c)
      const { ERROR_NOTIFICATION_TOKEN } = env<{
        ERROR_NOTIFICATION_TOKEN: string
      }>(c)

      await notifyError(
        {
          title: 'Invalid request body',
          environment: ENVIRONMENT,
        },
        ERROR_NOTIFICATION_TOKEN,
      )
      */

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
