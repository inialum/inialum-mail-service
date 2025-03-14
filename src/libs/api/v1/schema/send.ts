import { z } from '@hono/zod-openapi'

/*
 * Schema for mail body content
 */
export const MailBodyContentSchema = z
	.object({
		text: z
			.string({
				required_error: 'This field is required',
			})
			.openapi({
				example: 'Body content in plain text',
			}),
		html: z.string().optional().openapi({
			example: 'Body content in HTML',
		}),
	})
	.openapi('MailBodyContent')

/**
 * Schema for request of POST /send
 */
export const SendApiRequestSchemaV1 = z
	.object({
		from: z.string().email('Invalid email address').openapi({
			example: 'noreply@mail.inialum.org',
		}),
		to: z.string().email('Invalid email address').openapi({
			example: 'to@example.com',
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

export type SendApiRequestV1 = z.infer<typeof SendApiRequestSchemaV1>

/**
 * Schema for response of POST /send
 */
export const SendApiResponseSchemaV1 = z
	.object({
		status: z.string().openapi({
			example: 'ok',
		}),
	})
	.openapi('Response')

/**
 * Schema for Zod validation error
 */
const ZodValidationError = z.any()

/**
 * Schema for 400 error response of POST /send
 */
export const SendApi400ErrorSchemaV1 = z.object({
	message: z.string().openapi({
		example: 'Validation error',
	}),
	issues: ZodValidationError.openapi({
		example: [
			{
				code: 'invalid_type',
				expected: 'string',
				received: 'undefined',
				path: ['to'],
				message: 'Required',
			},
			{
				code: 'invalid_type',
				expected: 'string',
				received: 'undefined',
				path: ['subject'],
				message: 'This field is required',
			},
		],
	}),
})

/**
 * Schema for 500 error response of POST /send
 */
export const SendApi500ErrorSchemaV1 = z.object({
	message: z.string().openapi({
		example: 'Internal server error',
	}),
})
