import { eq } from 'drizzle-orm'
import { sign } from 'hono/jwt'

import { createDb } from '../../../db'
import { campaigns, distributions, recipients } from '../../../db/schema'
import worker from '../../../index'
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

const authHeaders = async (idempotencyKey?: string) => {
	const token = await sign(
		{
			sub: 'workers-test',
			exp: Math.floor(Date.now() / 1000) + 3600,
		},
		TEST_TOKEN_SECRET,
		'HS256',
	)

	return {
		Authorization: `Bearer ${token}`,
		'Content-Type': 'application/json',
		...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
	}
}

const requestApi = async (path: string, init: RequestInit) => {
	const context = createExecutionContext()
	const response = await worker.fetch?.(
		new Request(`https://mail.test${path}`, init) as never,
		testEnv,
		context,
	)
	await waitOnExecutionContext(context)
	if (!response) {
		throw new Error('Worker fetch handler is not defined')
	}
	return response
}

const distributionBody = (
	count: number,
	kind: 'transactional' | 'marketing' = 'transactional',
) => ({
	kind,
	source: 'test',
	from: 'noreply@mail.inialum.org',
	subject: `Subject ${count}`,
	body: { text: 'Hello', html: '<p>Hello</p>' },
	...(kind === 'marketing' ? { subscriptionKind: 'inialum' as const } : {}),
	recipients: Array.from({ length: count }, (_, index) => ({
		email: `user${index}@example.com`,
		...(kind === 'marketing' ? { unsubscribeToken: `tok-${index}` } : {}),
	})),
})

describe('distribution history API', () => {
	beforeEach(async () => {
		await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS)
		vi.mocked(sendEmailWithSES).mockReset()
		vi.mocked(sendEmailWithSES).mockResolvedValue({
			$metadata: { httpStatusCode: 200 },
			MessageId: 'ses-1',
		})
	})

	test('rejects unauthenticated requests', async () => {
		const response = await requestApi('/api/v1/distributions', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(distributionBody(1)),
		})
		expect(response.status).toBe(401)
	})

	test('rejects an empty recipient list', async () => {
		const response = await requestApi('/api/v1/distributions', {
			method: 'POST',
			headers: await authHeaders(`empty-${crypto.randomUUID()}`),
			body: JSON.stringify({ ...distributionBody(1), recipients: [] }),
		})
		expect(response.status).toBe(400)
	})

	test('accepts 1, 400, 401, and 800 recipients and splits campaigns', async () => {
		const db = createDb(testEnv.DB)

		const one = await requestApi('/api/v1/distributions', {
			method: 'POST',
			headers: await authHeaders(`one-${crypto.randomUUID()}`),
			body: JSON.stringify(distributionBody(1)),
		})
		expect(one.status).toBe(202)

		const fourHundred = await requestApi('/api/v1/distributions', {
			method: 'POST',
			headers: await authHeaders(`400-${crypto.randomUUID()}`),
			body: JSON.stringify(distributionBody(400)),
		})
		expect(fourHundred.status).toBe(202)

		const fourOhOne = await requestApi('/api/v1/distributions', {
			method: 'POST',
			headers: await authHeaders(`401-${crypto.randomUUID()}`),
			body: JSON.stringify(distributionBody(401)),
		})
		expect(fourOhOne.status).toBe(202)
		const fourOhOneBody = (await fourOhOne.json()) as { distributionId: string }
		const child401 = await db
			.select()
			.from(campaigns)
			.where(eq(campaigns.distributionId, fourOhOneBody.distributionId))
		expect(child401).toHaveLength(2)

		const eightHundred = await requestApi('/api/v1/distributions', {
			method: 'POST',
			headers: await authHeaders(`800-${crypto.randomUUID()}`),
			body: JSON.stringify(distributionBody(800)),
		})
		expect(eightHundred.status).toBe(202)
		const eightBody = (await eightHundred.json()) as { distributionId: string }
		const child800 = await db
			.select()
			.from(campaigns)
			.where(eq(campaigns.distributionId, eightBody.distributionId))
		expect(child800).toHaveLength(2)
	})

	test('replays the same Idempotency-Key without creating another distribution', async () => {
		const key = `dist-replay-${crypto.randomUUID()}`
		const body = distributionBody(2)
		const first = await requestApi('/api/v1/distributions', {
			method: 'POST',
			headers: await authHeaders(key),
			body: JSON.stringify(body),
		})
		const replay = await requestApi('/api/v1/distributions', {
			method: 'POST',
			headers: await authHeaders(key),
			body: JSON.stringify(body),
		})
		const db = createDb(testEnv.DB)
		const firstBody = (await first.json()) as { distributionId: string }
		expect(replay.status).toBe(202)
		expect(await replay.json()).toEqual(firstBody)
		expect(replay.headers.get('Idempotency-Replayed')).toBe('true')

		const rows = await db
			.select()
			.from(distributions)
			.where(eq(distributions.id, firstBody.distributionId))
		expect(rows).toHaveLength(1)
	})

	test('returns 422 when the same key is reused with a different payload', async () => {
		const key = `dist-mismatch-${crypto.randomUUID()}`
		const first = await requestApi('/api/v1/distributions', {
			method: 'POST',
			headers: await authHeaders(key),
			body: JSON.stringify(distributionBody(1)),
		})
		const conflict = await requestApi('/api/v1/distributions', {
			method: 'POST',
			headers: await authHeaders(key),
			body: JSON.stringify({
				...distributionBody(1),
				subject: 'Different',
			}),
		})
		expect(first.status).toBe(202)
		expect(conflict.status).toBe(422)
	})

	test('lists, details, and recipients with cursor filters', async () => {
		const created = await requestApi('/api/v1/distributions', {
			method: 'POST',
			headers: await authHeaders(`list-${crypto.randomUUID()}`),
			body: JSON.stringify({
				...distributionBody(2),
				subject: 'Cursor subject',
			}),
		})
		const { distributionId } = (await created.json()) as {
			distributionId: string
		}

		const list = await requestApi('/api/v1/distributions?q=Cursor&limit=1', {
			method: 'GET',
			headers: await authHeaders(),
		})
		expect(list.status).toBe(200)
		const listBody = (await list.json()) as {
			items: { id: string; subject: string }[]
			nextCursor?: string
		}
		expect(listBody.items[0]?.subject).toBe('Cursor subject')

		const detail = await requestApi(`/api/v1/distributions/${distributionId}`, {
			method: 'GET',
			headers: await authHeaders(),
		})
		expect(detail.status).toBe(200)
		const detailBody = (await detail.json()) as {
			body: { text: string } | null
			campaigns: unknown[]
		}
		expect(detailBody.body?.text).toBe('Hello')
		expect(detailBody.campaigns).toHaveLength(1)

		const recipientPage = await requestApi(
			`/api/v1/distributions/${distributionId}/recipients?limit=1`,
			{
				method: 'GET',
				headers: await authHeaders(),
			},
		)
		expect(recipientPage.status).toBe(200)
		const recipientsBody = (await recipientPage.json()) as {
			items: { email: string }[]
			nextCursor?: string
		}
		expect(recipientsBody.items).toHaveLength(1)
		expect(recipientsBody.nextCursor).toBeTypeOf('string')
	})

	test('indexes a synchronous /send on the history tables', async () => {
		const response = await requestApi('/api/v1/send', {
			method: 'POST',
			headers: await authHeaders(`send-${crypto.randomUUID()}`),
			body: JSON.stringify({
				from: 'noreply@mail.inialum.org',
				to: 'one@example.com',
				subject: 'Sync send',
				body: { text: 'hi' },
			}),
		})
		expect(response.status).toBe(200)

		const db = createDb(testEnv.DB)
		const [distribution] = await db
			.select()
			.from(distributions)
			.where(eq(distributions.source, 'send'))
			.limit(1)
		expect(distribution?.source).toBe('send')
		const [recipient] = await db
			.select()
			.from(recipients)
			.where(eq(recipients.distributionId, distribution?.id ?? ''))
		expect(recipient?.status).toBe('sent')
		expect(recipient?.providerMessageId).toBe('ses-1')
	})

	test('rejects more than 800 recipients and marketing without required fields', async () => {
		const tooMany = await requestApi('/api/v1/distributions', {
			method: 'POST',
			headers: await authHeaders(`801-${crypto.randomUUID()}`),
			body: JSON.stringify(distributionBody(801)),
		})
		expect(tooMany.status).toBe(400)

		const missingKind = await requestApi('/api/v1/distributions', {
			method: 'POST',
			headers: await authHeaders(`mkt-${crypto.randomUUID()}`),
			body: JSON.stringify({
				...distributionBody(1, 'marketing'),
				subscriptionKind: undefined,
			}),
		})
		expect(missingKind.status).toBe(400)

		const missingToken = await requestApi('/api/v1/distributions', {
			method: 'POST',
			headers: await authHeaders(`tok-${crypto.randomUUID()}`),
			body: JSON.stringify({
				kind: 'marketing',
				subscriptionKind: 'inialum',
				source: 'test',
				from: 'noreply@mail.inialum.org',
				subject: 'Marketing',
				body: { text: 'Hello' },
				recipients: [{ email: 'user0@example.com' }],
			}),
		})
		expect(missingToken.status).toBe(400)
	})

	test('dedupes recipients and returns 409 while a key is in progress', async () => {
		const created = await requestApi('/api/v1/distributions', {
			method: 'POST',
			headers: await authHeaders(`dedupe-${crypto.randomUUID()}`),
			body: JSON.stringify({
				...distributionBody(1),
				recipients: [
					{ email: 'Ada@example.com' },
					{ email: 'ada@example.com' },
				],
			}),
		})
		expect(created.status).toBe(202)
		const { distributionId } = (await created.json()) as {
			distributionId: string
		}
		const db = createDb(testEnv.DB)
		const rows = await db
			.select()
			.from(recipients)
			.where(eq(recipients.distributionId, distributionId))
		expect(rows).toHaveLength(1)

		const key = `conflict-${crypto.randomUUID()}`
		let release!: () => void
		const gate = new Promise<void>((resolve) => {
			release = resolve
		})
		vi.mocked(sendEmailWithSES).mockImplementationOnce(async () => {
			await gate
			return {
				$metadata: { httpStatusCode: 200 },
				MessageId: 'ses-hold',
			}
		})
		const first = requestApi('/api/v1/send', {
			method: 'POST',
			headers: await authHeaders(key),
			body: JSON.stringify({
				from: 'noreply@mail.inialum.org',
				to: 'hold@example.com',
				subject: 'Hold',
				body: { text: 'hi' },
			}),
		})
		const conflict = await requestApi('/api/v1/send', {
			method: 'POST',
			headers: await authHeaders(key),
			body: JSON.stringify({
				from: 'noreply@mail.inialum.org',
				to: 'hold@example.com',
				subject: 'Hold',
				body: { text: 'hi' },
			}),
		})
		expect(conflict.status).toBe(409)
		release()
		expect((await first).status).toBe(200)
	})

	test('publishes distribution paths on OpenAPI with Bearer security', async () => {
		const response = await requestApi('/schema/v1', { method: 'GET' })
		expect(response.status).toBe(200)
		const schema = (await response.json()) as {
			paths: Record<string, unknown>
			components?: { securitySchemes?: Record<string, unknown> }
		}
		const pathKeys = Object.keys(schema.paths).join('\n')
		expect(pathKeys).toMatch(/distributions/)
		expect(pathKeys).toMatch(/distributions\/\{id\}/)
		expect(pathKeys).toMatch(/distributions\/\{id\}\/recipients/)
		expect(schema.components?.securitySchemes?.Bearer).toBeDefined()
		expect(schema.components?.securitySchemes?.bearerAuth).toBeUndefined()
	})
})
