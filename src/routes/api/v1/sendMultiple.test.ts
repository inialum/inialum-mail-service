import type { ZodError } from 'zod'

import { apiV1 } from '.'
import type { SendMultipleApiRequestV1 } from '../../../libs/api/v1/schema/sendMultiple'
import { sendEmailWithSendGrid } from '../../../libs/mail/sendgrid'

vi.mock('../../../libs/mail/sendgrid', () => {
	return {
		sendEmailWithSendGrid: vi.fn(),
	}
})

vi.mock('hono/adapter', () => {
	return {
		env: () => getMiniflareBindings(),
	}
})

describe('API v1', () => {
	const apiBodyContent: SendMultipleApiRequestV1 = {
		from: 'noreply@mail.inialum.org',
		to: ['test@expmle.com', 'test2@expmle.com'],
		subject: 'Test',
		body: {
			text: 'This is a test mail.',
			html: '<p>Hello World!</p>',
		},
	}

	test('POST /send (should return data with no errors)', async () => {
		vi.mocked(sendEmailWithSendGrid).mockResolvedValueOnce()

		const res = await apiV1.request('/send-multiple', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify(apiBodyContent),
		})

		expect(res.status).toBe(200)
		expect(await res.json()).toEqual({
			status: 'ok',
		})
	})

	test('POST /send (should return with error message)', async () => {
		const res = await apiV1.request('/send-multiple', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				from: 'noreply@mail.inialum.org',
				to: ['.test@expmle.com'],
				body: { ...apiBodyContent.body, text: undefined },
			}),
		})

		expect(res.status).toBe(400)
		expect(await res.json()).toEqual({
			message: 'Validation error',
			issues: [
				{
					code: 'invalid_string',
					message: 'Invalid email address',
					path: ['to', 0],
					validation: 'email',
				},
				{
					code: 'invalid_type',
					expected: 'string',
					message: 'This field is required',
					path: ['subject'],
					received: 'undefined',
				},
				{
					code: 'invalid_type',
					expected: 'string',
					message: 'This field is required',
					path: ['body', 'text'],
					received: 'undefined',
				},
			] as ZodError['issues'],
		})
	})
})
