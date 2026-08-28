import { sign } from 'hono/jwt'

import worker from '../../../index'
import type { SendApiRequestV1 } from '../../../libs/api/v1/schema/send'
import { sendEmailWithSES } from '../../../libs/mail/ses'
import { testEnv } from '../../../types/testEnv'
import {
	applyD1Migrations,
	createExecutionContext,
	waitOnExecutionContext,
} from 'cloudflare:test'

vi.mock('../../../libs/mail/ses', () => ({
	sendEmailWithSES: vi.fn(),
}))

const TEST_TOKEN_SECRET = 'test-token-secret'

const body: SendApiRequestV1 = {
	from: 'noreply@mail.inialum.org',
	to: 'test@example.com',
	subject: 'Test',
	body: {
		text: 'This is a test mail.',
		html: '<p>Hello World!</p>',
	},
}

const requestSend = async (payload: SendApiRequestV1, key: string) => {
	const token = await sign(
		{
			sub: 'workers-test',
			exp: Math.floor(Date.now() / 1000) + 3600,
		},
		TEST_TOKEN_SECRET,
		'HS256',
	)

	const context = createExecutionContext()
	const response = await worker.fetch?.(
		new Request('https://mail.test/api/v1/send', {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${token}`,
				'Content-Type': 'application/json',
				'Idempotency-Key': key,
			},
			body: JSON.stringify(payload),
		}) as never,
		testEnv,
		context,
	)
	await waitOnExecutionContext(context)
	if (!response) {
		throw new Error('Worker fetch handler is not defined')
	}
	return response
}

describe('Workers idempotency integration', () => {
	beforeEach(async () => {
		await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS)
		vi.mocked(sendEmailWithSES).mockReset()
		vi.mocked(sendEmailWithSES).mockResolvedValue({
			$metadata: { httpStatusCode: 200 },
			MessageId: 'ses-message-1',
		})
		expect(testEnv.DB).toBeDefined()
	})

	test('creates the D1 table and replays the same response without resending', async () => {
		const key = `workers-replay-${crypto.randomUUID()}`

		const first = await requestSend(body, key)
		const replay = await requestSend(body, key)

		expect(first.status).toBe(200)
		expect(await first.json()).toEqual({ status: 'ok' })
		expect(replay.status).toBe(200)
		expect(await replay.json()).toEqual({ status: 'ok' })
		expect(sendEmailWithSES).toHaveBeenCalledTimes(1)
	})

	test('rejects reuse of a key with a different payload', async () => {
		const key = `workers-fingerprint-${crypto.randomUUID()}`

		const first = await requestSend(body, key)
		const differentPayload = {
			...body,
			subject: 'Different subject',
		}
		const conflict = await requestSend(differentPayload, key)

		expect(first.status).toBe(200)
		expect(conflict.status).toBe(422)
		expect(await conflict.json()).toMatchObject({
			message: expect.any(String),
		})
		expect(sendEmailWithSES).toHaveBeenCalledTimes(1)
	})
})
