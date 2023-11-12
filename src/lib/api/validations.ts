import { z } from 'zod'

export const SendApiSchemaV1 = z.object({
  to: z.string().email('Invalid email address'),
  subject: z.string({
    required_error: 'This field is required',
  }),
  body: z.string({
    required_error: 'This field is required',
  }),
})
