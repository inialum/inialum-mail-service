import { type MemoryStore, memoryStore } from 'hono-idempotency/stores/memory'
import type { ZodError } from 'zod'

import type { SendApiRequestV1 } from '../../../libs/api/v1/schema/send'
import { sendEmailWithSES } from '../../../libs/mail/ses'
import { apiV1 } from '.'

const idempotencyState = vi.hoisted(() => ({
	store: undefined as MemoryStore | undefined,
}))

vi.mock('../../../libs/mail/ses', () => {
	return {
		sendEmailWithSES: vi.fn(),
	}
})

vi.mock('../../../libs/idempotency/store', () => {
	return {
		createMailIdempotencyStore: () => {
			if (!idempotencyState.store) {
				throw new Error('Idempotency test store is not initialized')
			}
			return idempotencyState.store
		},
	}
})

vi.mock('hono/adapter', () => {
	return {
		env: () => ({
			...getMiniflareBindings(),
			DB: {},
		}),
	}
})

describe('API v1', () => {
	const apiBodyContent: SendApiRequestV1 = {
		from: 'noreply@mail.inialum.org',
		to: 'test@expmle.com',
		subject: 'Test',
		body: {
			text: 'This is a test mail.',
			html: '<p>Hello World!</p>',
		},
	}

	const requestSend = (body: SendApiRequestV1, idempotencyKey?: string) =>
		apiV1.request('/send', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
			},
			body: JSON.stringify(body),
		})

	beforeEach(() => {
		vi.clearAllMocks()
		idempotencyState.store = memoryStore()
	})

	test('POST /send without Idempotency-Key sends successfully', async () => {
		vi.mocked(sendEmailWithSES).mockResolvedValueOnce({
			$metadata: {
				httpStatusCode: 200,
			},
		})

		const res = await requestSend(apiBodyContent)

		expect(res.status).toBe(200)
		expect(await res.json()).toEqual({
			status: 'ok',
		})
		expect(sendEmailWithSES).toHaveBeenCalledTimes(1)
	})

	test('POST /send with Idempotency-Key sends successfully', async () => {
		vi.mocked(sendEmailWithSES).mockResolvedValueOnce({
			$metadata: { httpStatusCode: 200 },
		})

		const res = await requestSend(apiBodyContent, 'invitation:inv_1:g1')

		expect(res.status).toBe(200)
		expect(await res.json()).toEqual({ status: 'ok' })
		expect(sendEmailWithSES).toHaveBeenCalledTimes(1)
	})

	test('POST /send (should return with error message)', async () => {
		const res = await apiV1.request('/send', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				from: 'noreply@mail.inialum.org',
				to: '.test@expmle.com',
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
					path: ['to'],
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
