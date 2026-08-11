import type {
	D1DatabaseLike,
	D1PreparedStatementLike,
} from 'hono-idempotency/stores/cloudflare-d1'

import {
	IDEMPOTENCY_IN_PROGRESS_TTL_MS,
	IDEMPOTENCY_REPLAY_TTL_MS,
} from '../../constants/idempotency'
import { createMailIdempotencyStore } from './store'

type Row = {
	key: string
	fingerprint: string
	status: string
	response: string | null
	created_at: number
}

type FakeD1State = {
	rows: Map<string, Row>
	queries: string[]
	tableExists: boolean
}

class FakeD1Statement implements D1PreparedStatementLike {
	private params: unknown[] = []

	constructor(
		private readonly state: FakeD1State,
		private readonly sql: string,
	) {}

	bind(...params: unknown[]): D1PreparedStatementLike {
		this.params = params
		return this
	}

	async run() {
		const sql = this.sql.replace(/\s+/g, ' ').trim()
		this.state.queries.push(sql)
		let changes = 0

		if (sql.startsWith('CREATE TABLE IF NOT EXISTS')) {
			this.state.tableExists = true
			return { success: true, meta: { changes } }
		}
		this.assertTableExists(sql)

		if (sql.startsWith('INSERT OR IGNORE')) {
			const [key, fingerprint, status, response, createdAt] = this.params as [
				string,
				string,
				string,
				string | null,
				number,
			]
			if (!this.state.rows.has(key)) {
				this.state.rows.set(key, {
					key,
					fingerprint,
					status,
					response,
					created_at: createdAt,
				})
				changes = 1
			}
			return { success: true, meta: { changes } }
		}

		if (sql.startsWith('UPDATE')) {
			const [status, response, key] = this.params as [string, string, string]
			const row = this.state.rows.get(key)
			if (row) {
				row.status = status
				row.response = response
				changes = 1
			}
			return { success: true, meta: { changes } }
		}

		if (sql.startsWith('DELETE')) {
			changes = this.deleteRows(sql)
			return { success: true, meta: { changes } }
		}

		throw new Error(`Unsupported test SQL: ${sql}`)
	}

	async first(): Promise<Record<string, unknown> | null> {
		const sql = this.sql.replace(/\s+/g, ' ').trim()
		this.state.queries.push(sql)
		this.assertTableExists(sql)
		const [key, threshold] = this.params as [string, number]
		const row = this.state.rows.get(key)
		return row && row.created_at >= threshold ? { ...row } : null
	}

	private assertTableExists(sql: string) {
		if (!this.state.tableExists) {
			throw new Error(`SQL ran before table initialization: ${sql}`)
		}
	}

	private deleteRows(sql: string): number {
		if (sql.includes('WHERE key = ? AND status = ? AND created_at <= ?')) {
			const [key, status, threshold] = this.params as [string, string, number]
			const row = this.state.rows.get(key)
			if (row && row.status === status && row.created_at <= threshold) {
				this.state.rows.delete(key)
				return 1
			}
			return 0
		}

		if (sql.includes('WHERE key = ? AND created_at < ?')) {
			const [key, threshold] = this.params as [string, number]
			const row = this.state.rows.get(key)
			if (row && row.created_at < threshold) {
				this.state.rows.delete(key)
				return 1
			}
			return 0
		}

		if (sql.includes('WHERE created_at < ?')) {
			const [threshold] = this.params as [number]
			let changes = 0
			for (const [key, row] of this.state.rows) {
				if (row.created_at < threshold) {
					this.state.rows.delete(key)
					changes += 1
				}
			}
			return changes
		}

		const [key] = this.params as [string]
		return this.state.rows.delete(key) ? 1 : 0
	}
}

class FakeD1Database implements D1DatabaseLike {
	private readonly state: FakeD1State = {
		rows: new Map<string, Row>(),
		queries: [],
		tableExists: false,
	}

	prepare(sql: string): D1PreparedStatementLike {
		return new FakeD1Statement(this.state, sql)
	}

	seed(row: Row) {
		this.state.tableExists = true
		this.state.rows.set(row.key, row)
	}

	get queries() {
		return this.state.queries
	}
}

describe('createMailIdempotencyStore', () => {
	test('initializes the table before cleanup when lock is called directly', async () => {
		const database = new FakeD1Database()
		const store = createMailIdempotencyStore(database)

		await store.lock('POST:/send:new', {
			key: 'new',
			fingerprint: 'new',
			status: 'processing',
			createdAt: Date.now(),
		})

		const createIndex = database.queries.findIndex((sql) =>
			sql.startsWith('CREATE TABLE IF NOT EXISTS'),
		)
		const deleteIndex = database.queries.findIndex((sql) =>
			sql.startsWith('DELETE'),
		)
		expect(createIndex).toBe(0)
		expect(deleteIndex).toBeGreaterThan(createIndex)
	})

	test('reclaims a stale processing lock', async () => {
		const database = new FakeD1Database()
		const store = createMailIdempotencyStore(database)
		const key = 'POST:/send:stale'
		await store.lock(key, {
			key: 'stale',
			fingerprint: 'old',
			status: 'processing',
			createdAt: Date.now() - IDEMPOTENCY_IN_PROGRESS_TTL_MS - 1_000,
		})

		expect(await store.get(key)).toBeUndefined()
		expect(
			await store.lock(key, {
				key: 'stale',
				fingerprint: 'new',
				status: 'processing',
				createdAt: Date.now(),
			}),
		).toBe(true)
		expect(await store.get(key)).toMatchObject({ fingerprint: 'new' })
	})

	test('deletes an expired primary key before taking a new lock', async () => {
		const database = new FakeD1Database()
		const store = createMailIdempotencyStore(database)
		const key = 'POST:/send:expired'
		database.seed({
			key,
			fingerprint: 'old',
			status: 'completed',
			response: JSON.stringify({ status: 200, headers: {}, body: '{}' }),
			created_at: Date.now() - IDEMPOTENCY_REPLAY_TTL_MS - 1_000,
		})

		expect(
			await store.lock(key, {
				key: 'expired',
				fingerprint: 'new',
				status: 'processing',
				createdAt: Date.now(),
			}),
		).toBe(true)
		expect(await store.get(key)).toMatchObject({
			fingerprint: 'new',
			status: 'processing',
		})
	})

	test('stores an ambiguous response instead of deleting its lock', async () => {
		const database = new FakeD1Database()
		const store = createMailIdempotencyStore(database)
		const key = 'POST:/send:timeout'
		await store.lock(key, {
			key: 'timeout',
			fingerprint: 'payload',
			status: 'processing',
			createdAt: Date.now(),
		})

		store.completeOnNextDelete({
			status: 500,
			headers: { 'content-type': 'application/json' },
			body: '{"message":"SES request timed out"}',
		})
		await store.delete(key)

		expect(await store.get(key)).toMatchObject({
			status: 'completed',
			response: {
				status: 500,
				body: '{"message":"SES request timed out"}',
			},
		})
		await store.delete(key)
		expect(await store.get(key)).toBeUndefined()
	})
})
