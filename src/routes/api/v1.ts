import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { env } from 'hono/adapter'
import { z } from 'zod'

import { sendEmailWithSES } from '@/lib/mail/ses'

export const apiV1 = new Hono()

const schema = z.object({
  to: z.string().email('Invalid email address'),
  subject: z.string({
    required_error: 'This field is required',
  }),
  body: z.string({
    required_error: 'This field is required',
  }),
})

apiV1.post(
  '/send',
  zValidator('json', schema, (result, c) => {
    if (!result.success) {
      return c.json(
        {
          message: 'Invalid request body',
          issues: result.error.issues,
        },
        400,
      )
    }
  }),
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
          return c.json(
            {
              message: e.message,
            },
            500,
          )
        }
      }
    }
  },
)
