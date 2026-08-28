import type { StoredResponse } from 'hono-idempotency'
import { type MemoryStore, memoryStore } from 'hono-idempotency/stores/memory'
import type { ZodError } from 'zod'

import {
	SendApi400ErrorSchemaV1,
	type SendApiRequestV1,
} from '../../../libs/api/v1/schema/send'
import { finalizeSyncDistribution } from '../../../libs/distribution/syncSend'
import { sendEmailWithSES } from '../../../libs/mail/ses'
import { apiV1 } from '.'

type ControlledMemoryStore = MemoryStore & {
	completeOnNextDelete: (response: StoredResponse) => void
}

const idempotencyState = vi.hoisted(() => ({
	store: undefined as ControlledMemoryStore | undefined,
}))

vi.mock('../../../constants/idempotency', async (importOriginal) => ({
	...(await importOriginal<typeof import('../../../constants/idempotency')>()),
	IDEMPOTENCY_SES_TIMEOUT_MS: 10,
}))

const controlledMemoryStore = (): ControlledMemoryStore => {
	const inner = memoryStore()
	let completionOnDelete: StoredResponse | undefined

	return {
		...inner,
		get size() {
			return inner.size
		},
		completeOnNextDelete(response) {
			completionOnDelete = response
		},
		async delete(key) {
			if (completionOnDelete) {
				const response = completionOnDelete
				completionOnDelete = undefined
				await inner.complete(key, response)
				return
			}
			await inner.delete(key)
		},
	}
}

vi.mock('../../../libs/mail/ses', () => {
	return {
		sendEmailWithSES: vi.fn(),
	}
})

vi.mock('../../../libs/distribution/syncSend', () => {
	return {
		createSyncDistribution: vi.fn(async () => ({
			distributionId: 'dst_test',
			campaignId: 'cmp_test',
		})),
		finalizeSyncDistribution: vi.fn(),
	}
})

vi.mock('../../../libs/distribution/indexRecipient', () => {
	return {
		getExistingSentOutcome: vi.fn(async () => null),
		finalizeRecipientDelivery: vi.fn(),
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
			ENVIRONMENT: 'test',
			AWS_ACCESS_KEY_ID: 'test-access-key-id',
			AWS_SECRET_ACCESS_KEY: 'test-secret-access-key',
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
		idempotencyState.store = controlledMemoryStore()
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

	test('POST /send replays a timeout instead of resending an unknown SES outcome', async () => {
		let aborted = false
		vi.mocked(sendEmailWithSES).mockImplementationOnce(
			(_mail, _credentials, _endpoint, options) =>
				new Promise((_, reject) => {
					options?.abortSignal?.addEventListener(
						'abort',
						() => {
							aborted = true
							reject(new Error('aborted'))
						},
						{ once: true },
					)
				}),
		)

		const timedOut = await requestSend(apiBodyContent, 'invitation:timeout:g1')
		const retry = await requestSend(apiBodyContent, 'invitation:timeout:g1')

		expect(timedOut.status).toBe(500)
		expect(retry.status).toBe(500)
		expect(await retry.json()).toEqual({
			message: 'SES request timed out after 10ms',
		})
		expect(retry.headers.get('Idempotency-Replayed')).toBe('true')
		expect(aborted).toBe(true)
		expect(sendEmailWithSES).toHaveBeenCalledTimes(1)
	})

	test('POST /send preserves timeout replay when failure history cannot be finalized', async () => {
		let aborted = false
		vi.mocked(sendEmailWithSES).mockImplementationOnce(
			(_mail, _credentials, _endpoint, options) =>
				new Promise((_, reject) => {
					options?.abortSignal?.addEventListener(
						'abort',
						() => {
							aborted = true
							reject(new Error('aborted'))
						},
						{ once: true },
					)
				}),
		)
		vi.mocked(finalizeSyncDistribution).mockRejectedValueOnce(
			new Error('history unavailable'),
		)
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

		const timedOut = await requestSend(
			apiBodyContent,
			'invitation:history-timeout:g1',
		)
		const retry = await requestSend(
			apiBodyContent,
			'invitation:history-timeout:g1',
		)

		expect(timedOut.status).toBe(500)
		expect(retry.status).toBe(500)
		expect(await retry.json()).toEqual({
			message: 'SES request timed out after 10ms',
		})
		expect(retry.headers.get('Idempotency-Replayed')).toBe('true')
		expect(aborted).toBe(true)
		expect(sendEmailWithSES).toHaveBeenCalledTimes(1)
		expect(finalizeSyncDistribution).toHaveBeenCalledTimes(1)
		expect(errorSpy).toHaveBeenCalledWith(
			expect.stringContaining('mail_history.sync_index_failed'),
		)
		errorSpy.mockRestore()
	})

	test('POST /send documents the idempotency key length error', async () => {
		const res = await requestSend(apiBodyContent, 'a'.repeat(256))
		const body = await res.json()

		expect(res.status).toBe(400)
		expect(body).toEqual({
			error: 'KEY_TOO_LONG',
			message: 'Idempotency-Key must be at most 255 characters',
		})
		expect(SendApi400ErrorSchemaV1.safeParse(body).success).toBe(true)
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
