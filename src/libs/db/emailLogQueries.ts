import { desc } from 'drizzle-orm'

import type { DrizzleClient } from './client'
import { type MailLog, mailLogs } from './schema'

/**
 * Get email logs with optional filtering and pagination
 */
export const getEmailLogs = async (
	db: DrizzleClient,
	options: {
		status?: 'success' | 'failed'
		provider?: 'ses' | 'sendgrid'
		limit?: number
		offset?: number
	} = {},
): Promise<MailLog[]> => {
	const { status, provider, limit = 100, offset = 0 } = options

	try {
		// Simplified approach to avoid Drizzle type issues with complex queries
		// Get all logs first, then filter in memory for now
		const allLogs = await db
			.select()
			.from(mailLogs)
			.orderBy(desc(mailLogs.createdAt))

		// Apply filters in memory
		let filteredLogs = allLogs
		if (status) {
			filteredLogs = filteredLogs.filter((log) => log.status === status)
		}
		if (provider) {
			filteredLogs = filteredLogs.filter((log) => log.provider === provider)
		}

		// Apply pagination
		return filteredLogs.slice(offset, offset + limit)
	} catch (error) {
		console.error('Failed to get email logs:', error)
		return []
	}
}

/**
 * Get email log stats (counts per status and provider)
 */
export const getEmailStats = async (
	db: DrizzleClient,
): Promise<{
	totalCount: number
	successCount: number
	failedCount: number
	sesCount: number
	sendgridCount: number
}> => {
	try {
		// 全てのログを取得し、メモリ内で集計
		// D1とDrizzle-ORMの互換性の問題を避けるための方法
		const allLogs = await db.select().from(mailLogs)

		return {
			totalCount: allLogs.length,
			successCount: allLogs.filter((log) => log.status === 'success').length,
			failedCount: allLogs.filter((log) => log.status === 'failed').length,
			sesCount: allLogs.filter((log) => log.provider === 'ses').length,
			sendgridCount: allLogs.filter((log) => log.provider === 'sendgrid')
				.length,
		}
	} catch (error) {
		console.error('Failed to get email stats:', error)
		return {
			totalCount: 0,
			successCount: 0,
			failedCount: 0,
			sesCount: 0,
			sendgridCount: 0,
		}
	}
}
