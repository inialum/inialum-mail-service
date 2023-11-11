import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { z } from 'zod'

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
  (c) => {
    const data = c.req.valid('json')
    console.log(data)

    return c.json({
      status: 'ok',
    })
  },
)
