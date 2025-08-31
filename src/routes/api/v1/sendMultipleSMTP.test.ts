import { env } from 'hono/adapter'
import { SMTPApiError } from '../../../libs/error/applicationErrors'
import { saveMailLogToR2 } from '../../../libs/mail/r2Logger'
import { sendEmailWithSMTP } from '../../../libs/mail/smtp'
import { sendMultipleSMTPApiV1 } from './sendMultipleSMTP'

import type { SentMessageInfo } from 'nodemailer'
import type { SendMultipleSMTPApiRequestV1 } from '../../../libs/api/v1/schema/sendMultipleSMTP'

// Mock the SMTP send function
vi.mock('../../../libs/mail/smtp', () => ({
	sendEmailWithSMTP: vi.fn(),
}))

// Mock the R2 logger
vi.mock('../../../libs/mail/r2Logger', () => ({
	generateMessageId: vi.fn(() => 'test-message-id'),
	saveMailLogToR2: vi.fn(),
}))

vi.mock('hono/adapter', () => {
	return {
		env: vi.fn(() => ({
			SMTP_HOST: 'smtp.example.com',
			SMTP_PORT: '587',
			SMTP_USER: 'user@example.com',
			SMTP_PASS: 'password',
			MAIL_LOGS_BUCKET: {} as R2Bucket,
		})),
	}
})

describe('sendMultipleSMTPApiV1', () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})
	const validRequestBody: SendMultipleSMTPApiRequestV1 = {
		from: 'test@example.com',
		to: ['recipient@example.com'],
		subject: 'Test Subject',
		body: {
			text: 'Test message',
			html: '<p>Test message</p>',
		},
	}

	const mockSentMessageInfo: SentMessageInfo = {
		messageId: 'test-message-id',
		accepted: ['recipient@example.com'],
		rejected: [],
		envelope: { from: '', to: [] },
		response: 'OK',
		envelopeTime: 100,
		messageTime: 200,
		messageSize: 1024,
	}

	test('should send email successfully using environment SMTP config', async () => {
		vi.mocked(sendEmailWithSMTP).mockResolvedValue(mockSentMessageInfo)
		vi.mocked(saveMailLogToR2).mockResolvedValue()

		const res = await sendMultipleSMTPApiV1.request('/', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify(validRequestBody),
		})

		console.log('Response status:', res.status)
		if (res.status !== 200) {
			console.log('Response body:', await res.text())
		}

		expect(res.status).toBe(200)
		const responseData = await res.json()
		expect(responseData).toEqual({ status: 'ok' })

		expect(sendEmailWithSMTP).toHaveBeenCalledWith(
			{
				fromAddress: validRequestBody.from,
				toAddresses: validRequestBody.to,
				subject: validRequestBody.subject,
				body: validRequestBody.body,
			},
			{
				host: 'smtp.example.com',
				port: 587,
				user: 'user@example.com',
				pass: 'password',
				secure: false,
			},
		)

		expect(saveMailLogToR2).toHaveBeenCalledWith({} as R2Bucket, {
			timestamp: expect.any(String),
			from: validRequestBody.from,
			to: validRequestBody.to,
			subject: validRequestBody.subject,
			status: 'success',
			messageId: 'test-message-id',
		})
	})

	test('should return 400 for invalid email addresses', async () => {
		const invalidRequestBody = {
			...validRequestBody,
			from: 'invalid-email',
		}

		const res = await sendMultipleSMTPApiV1.request('/', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify(invalidRequestBody),
		})

		expect(res.status).toBe(400)
		const responseData = (await res.json()) as {
			message: string
			issues: unknown[]
		}
		expect(responseData.message).toBe('Validation error')
		expect(responseData.issues).toBeDefined()
	})

	test('should return 400 when required SMTP environment variables are missing', async () => {
		// Temporarily change mock for this test
		vi.mocked(env).mockReturnValueOnce({
			MAIL_LOGS_BUCKET: {} as R2Bucket,
		})

		const res = await sendMultipleSMTPApiV1.request('/', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify(validRequestBody),
		})

		expect(res.status).toBe(400)
		const responseData = (await res.json()) as { message: string }
		expect(responseData.message).toContain('SMTP configuration')
	})

	test('should return 500 when SMTP sending fails', async () => {
		vi.mocked(sendEmailWithSMTP).mockRejectedValue(
			new SMTPApiError('SMTP server connection failed'),
		)
		vi.mocked(saveMailLogToR2).mockResolvedValue()

		const res = await sendMultipleSMTPApiV1.request('/', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify(validRequestBody),
		})

		expect(res.status).toBe(500)

		expect(saveMailLogToR2).toHaveBeenCalledWith({} as R2Bucket, {
			timestamp: expect.any(String),
			from: validRequestBody.from,
			to: validRequestBody.to,
			subject: validRequestBody.subject,
			status: 'error',
			messageId: 'test-message-id',
			error: 'SMTP server connection failed',
		})
	})

	test('should handle R2 logging errors gracefully', async () => {
		vi.mocked(sendEmailWithSMTP).mockResolvedValue(mockSentMessageInfo)
		vi.mocked(saveMailLogToR2).mockRejectedValue(new Error('R2 error'))

		// Mock console.error to avoid error output in tests
		const consoleErrorSpy = vi
			.spyOn(console, 'error')
			.mockImplementation(() => {})

		const res = await sendMultipleSMTPApiV1.request('/', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify(validRequestBody),
		})

		expect(res.status).toBe(200)
		const responseData = await res.json()
		expect(responseData).toEqual({ status: 'ok' })

		expect(consoleErrorSpy).toHaveBeenCalledWith(
			'Failed to save success log to R2:',
			expect.any(Error),
		)

		consoleErrorSpy.mockRestore()
	})
})
