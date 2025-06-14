import { getEmailLogs, getEmailStats } from '../../../libs/db/emailLogQueries'

import { logsApiV1 } from './logs'

vi.mock('../../../libs/db/emailLogQueries', () => {
	return {
		getEmailLogs: vi.fn(),
		getEmailStats: vi.fn(),
	}
})

vi.mock('hono/adapter', () => {
	return {
		env: () => getMiniflareBindings(),
	}
})

describe('API v1 - Logs', () => {
	const mockEmailLogs = [
		{
			id: 1,
			fromAddress: 'noreply@mail.inialum.org',
			toAddress: 'test@example.com',
			subject: 'Test Email',
			status: 'success' as const,
			statusCode: 202,
			errorMessage: null,
			provider: 'ses' as const,
			createdAt: new Date('2024-01-01T00:00:00Z'),
		},
		{
			id: 2,
			fromAddress: 'noreply@mail.inialum.org',
			toAddress: 'test2@example.com',
			subject: 'Test Email 2',
			status: 'failed' as const,
			statusCode: 400,
			errorMessage: 'Invalid email',
			provider: 'sendgrid' as const,
			createdAt: new Date('2024-01-02T00:00:00Z'),
		},
	]

	const mockEmailStats = {
		totalCount: 10,
		successCount: 8,
		failedCount: 2,
		sesCount: 6,
		sendgridCount: 4,
	}

	test('GET /logs (should return logs with no filters)', async () => {
		vi.mocked(getEmailLogs).mockResolvedValueOnce(mockEmailLogs)

		const res = await logsApiV1.request(
			'/',
			{
				method: 'GET',
				headers: {
					'Content-Type': 'application/json',
				},
			},
			{
				DB: getMiniflareBindings().DB,
			},
		)

		expect(res.status).toStrictEqual(200)
		expect(await res.json()).toStrictEqual({
			logs: [
				{
					id: 1,
					fromAddress: 'noreply@mail.inialum.org',
					toAddress: 'test@example.com',
					subject: 'Test Email',
					status: 'success',
					statusCode: 202,
					errorMessage: null,
					provider: 'ses',
					createdAt: new Date('2024-01-01T00:00:00Z').getTime(),
				},
				{
					id: 2,
					fromAddress: 'noreply@mail.inialum.org',
					toAddress: 'test2@example.com',
					subject: 'Test Email 2',
					status: 'failed',
					statusCode: 400,
					errorMessage: 'Invalid email',
					provider: 'sendgrid',
					createdAt: new Date('2024-01-02T00:00:00Z').getTime(),
				},
			],
		})
		expect(getEmailLogs).toHaveBeenCalledWith(expect.anything(), {
			status: undefined,
			provider: undefined,
			limit: undefined,
			offset: undefined,
		})
	})

	test('GET /logs (should return logs with status filter)', async () => {
		const filteredLogs = [mockEmailLogs[0]]
		vi.mocked(getEmailLogs).mockResolvedValueOnce(filteredLogs)

		const res = await logsApiV1.request(
			'/?status=success',
			{
				method: 'GET',
				headers: {
					'Content-Type': 'application/json',
				},
			},
			{
				DB: getMiniflareBindings().DB,
			},
		)

		expect(res.status).toStrictEqual(200)
		expect(await res.json()).toStrictEqual({
			logs: [
				{
					id: 1,
					fromAddress: 'noreply@mail.inialum.org',
					toAddress: 'test@example.com',
					subject: 'Test Email',
					status: 'success',
					statusCode: 202,
					errorMessage: null,
					provider: 'ses',
					createdAt: new Date('2024-01-01T00:00:00Z').getTime(),
				},
			],
		})
		expect(getEmailLogs).toHaveBeenCalledWith(expect.anything(), {
			status: 'success',
			provider: undefined,
			limit: undefined,
			offset: undefined,
		})
	})

	test('GET /logs (should return logs with provider filter)', async () => {
		const filteredLogs = [mockEmailLogs[1]]
		vi.mocked(getEmailLogs).mockResolvedValueOnce(filteredLogs)

		const res = await logsApiV1.request(
			'/?provider=sendgrid',
			{
				method: 'GET',
				headers: {
					'Content-Type': 'application/json',
				},
			},
			{
				DB: getMiniflareBindings().DB,
			},
		)

		expect(res.status).toStrictEqual(200)
		expect(await res.json()).toStrictEqual({
			logs: [
				{
					id: 2,
					fromAddress: 'noreply@mail.inialum.org',
					toAddress: 'test2@example.com',
					subject: 'Test Email 2',
					status: 'failed',
					statusCode: 400,
					errorMessage: 'Invalid email',
					provider: 'sendgrid',
					createdAt: new Date('2024-01-02T00:00:00Z').getTime(),
				},
			],
		})
		expect(getEmailLogs).toHaveBeenCalledWith(expect.anything(), {
			status: undefined,
			provider: 'sendgrid',
			limit: undefined,
			offset: undefined,
		})
	})

	test('GET /logs (should return logs with pagination)', async () => {
		vi.mocked(getEmailLogs).mockResolvedValueOnce([mockEmailLogs[0]])

		const res = await logsApiV1.request(
			'/?limit=1&offset=0',
			{
				method: 'GET',
				headers: {
					'Content-Type': 'application/json',
				},
			},
			{
				DB: getMiniflareBindings().DB,
			},
		)

		expect(res.status).toStrictEqual(200)
		expect(await res.json()).toStrictEqual({
			logs: [
				{
					id: 1,
					fromAddress: 'noreply@mail.inialum.org',
					toAddress: 'test@example.com',
					subject: 'Test Email',
					status: 'success',
					statusCode: 202,
					errorMessage: null,
					provider: 'ses',
					createdAt: new Date('2024-01-01T00:00:00Z').getTime(),
				},
			],
		})

		expect(getEmailLogs).toHaveBeenCalledWith(expect.anything(), {
			status: undefined,
			provider: undefined,
			limit: 1,
			offset: 0,
		})
	})

	test('GET /logs (should handle database error)', async () => {
		vi.mocked(getEmailLogs).mockRejectedValueOnce(new Error('Database error'))

		const res = await logsApiV1.request(
			'/',
			{
				method: 'GET',
				headers: {
					'Content-Type': 'application/json',
				},
			},
			{
				DB: getMiniflareBindings().DB,
			},
		)

		expect(res.status).toStrictEqual(500)
		expect(await res.json()).toStrictEqual({
			message: 'Failed to fetch email logs',
		})
	})

	test('GET /logs/stats (should return email statistics)', async () => {
		vi.mocked(getEmailStats).mockResolvedValueOnce(mockEmailStats)

		const res = await logsApiV1.request(
			'/stats',
			{
				method: 'GET',
				headers: {
					'Content-Type': 'application/json',
				},
			},
			{
				DB: getMiniflareBindings().DB,
			},
		)

		expect(res.status).toStrictEqual(200)
		expect(await res.json()).toStrictEqual(mockEmailStats)
		expect(getEmailStats).toHaveBeenCalledWith(expect.anything())
	})

	test('GET /logs/stats (should handle database error)', async () => {
		vi.mocked(getEmailStats).mockRejectedValueOnce(new Error('Database error'))

		const res = await logsApiV1.request(
			'/stats',
			{
				method: 'GET',
				headers: {
					'Content-Type': 'application/json',
				},
			},
			{
				DB: getMiniflareBindings().DB,
			},
		)

		expect(res.status).toStrictEqual(500)
		expect(await res.json()).toStrictEqual({
			message: 'Failed to fetch email statistics',
		})
	})
})
