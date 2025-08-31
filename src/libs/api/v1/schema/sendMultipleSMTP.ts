import { z } from '@hono/zod-openapi'
import { MailBodyContentSchema } from './send'

/**
 * Schema for request of POST /send-multiple-smtp
 */
export const SendMultipleSMTPApiRequestSchemaV1 = z
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

export type SendMultipleSMTPApiRequestV1 = z.infer<
	typeof SendMultipleSMTPApiRequestSchemaV1
>

/**
 * Schema for response of POST /send-multiple-smtp
 */
export const SendMultipleSMTPApiResponseSchemaV1 = z
	.object({
		status: z.string().openapi({
			example: 'ok',
		}),
	})
	.openapi('Response')
