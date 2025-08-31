import { encodeWord } from 'libmime'
import nodemailer from 'nodemailer'

import { DEFAULT_MAIL_FROM_NAME } from '../../constants/mail'
import {
	DEFAULT_SMTP_PORT,
	DEFAULT_SMTP_SECURE,
	SMTP_MAX_CONNECTIONS,
	SMTP_MAX_MESSAGES,
} from '../../constants/smtp'
import type { Mail } from '../../types/Mail'
import { SMTPApiError } from '../error/applicationErrors'

export type SMTPConfig = {
	host: string
	port: number
	user: string
	pass: string
	secure: boolean
}

export const sendEmailWithSMTP = async (
	{ fromAddress, toAddresses, subject, body }: Mail,
	{
		host,
		port = DEFAULT_SMTP_PORT,
		user,
		pass,
		secure = DEFAULT_SMTP_SECURE,
	}: SMTPConfig,
) => {
	const from = `${encodeWord(DEFAULT_MAIL_FROM_NAME)} <${fromAddress}>`

	// Create transporter with connection pooling
	const transporter = nodemailer.createTransport({
		host,
		port,
		secure,
		auth: {
			user,
			pass,
		},
		pool: true,
		maxConnections: SMTP_MAX_CONNECTIONS,
		maxMessages: SMTP_MAX_MESSAGES,
	})

	try {
		const mailOptions = {
			from,
			to: toAddresses,
			subject,
			text: body.text,
			html: body.html,
		}

		const result = await transporter.sendMail(mailOptions)

		// Check if any recipients were rejected
		if (result.rejected && result.rejected.length > 0) {
			throw new SMTPApiError(
				`Some recipients were rejected: ${result.rejected.join(', ')}\nAccepted: ${result.accepted?.join(', ') || 'none'}`,
			)
		}

		return result
	} catch (error) {
		throw new SMTPApiError(
			error instanceof Error
				? error.message
				: `Unexpected error occurred while sending email via SMTP\nTo: ${toAddresses.join(', ')}`,
			{
				cause: error,
			},
		)
	} finally {
		// Close the transporter to clean up connections
		transporter.close()
	}
}
