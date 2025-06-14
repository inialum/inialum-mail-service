import { createDbClient } from './client'
import { mailLogs } from './schema'

export type EmailLogStatus = 'success' | 'failed'
export type EmailProvider = 'ses' | 'sendgrid'

export interface EmailLogEntry {
	fromAddress: string
	toAddress: string
	subject: string
	status: EmailLogStatus
	statusCode?: number
	errorMessage?: string
	provider: EmailProvider
}

/**
 * Log email send attempt to D1 database using Drizzle ORM
 */
export const logEmailSend = async (
	db: D1Database,
	logEntry: EmailLogEntry,
): Promise<void> => {
	try {
		const drizzleDb = createDbClient(db)

		await drizzleDb.insert(mailLogs).values({
			fromAddress: logEntry.fromAddress,
			toAddress: logEntry.toAddress,
			subject: logEntry.subject,
			status: logEntry.status,
			statusCode: logEntry.statusCode,
			errorMessage: logEntry.errorMessage,
			provider: logEntry.provider,
		})
	} catch (error) {
		// Log the error but don't throw - we don't want logging failures to affect email sending
		console.error('Failed to log email send:', error)
	}
}
