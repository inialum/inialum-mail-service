import { MailBodyContentSchema } from '@/libs/api/v1/schema/send'
import { z } from '@hono/zod-openapi'

/**
 * Schema for request of POST /send-multiple
 */
export const SendMultipleApiRequestSchemaV1 = z
  .object({
    from: z.string().email('Invalid email address').openapi({
      example: 'noreply@mail.inialum.org',
    }),
    to: z
      .string()
      .email('Invalid email address')
      .array()
      .openapi({
        example: ['to@example.com'],
      }),
    subject: z
      .string({
        required_error: 'This field is required',
      })
      .openapi({
        example: 'This is a subject',
      }),
    body: MailBodyContentSchema,
  })
  .openapi('Request')

export type SendMultipleApiRequestV1 = z.infer<
  typeof SendMultipleApiRequestSchemaV1
>

/**
 * Schema for response of POST /send-multiple
 */
export const SendMultipleApiResponseSchemaV1 = z
  .object({
    status: z.string().openapi({
      example: 'ok',
    }),
  })
  .openapi('Response')
