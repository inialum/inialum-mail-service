import type { Transporter } from 'nodemailer'
import nodemailer from 'nodemailer'

import type { Mail } from '../../types/Mail'
import { SMTPApiError } from '../error/applicationErrors'
import { sendEmailWithSMTP } from './smtp'

// Mock nodemailer
vi.mock('nodemailer')
const mockNodemailer = vi.mocked(nodemailer)

describe('sendEmailWithSMTP', () => {
	const mockMail: Mail = {
		fromAddress: 'test@example.com',
		toAddresses: ['recipient1@example.com', 'recipient2@example.com'],
		subject: 'Test Subject',
		body: {
			text: 'Test plain text body',
			html: '<p>Test HTML body</p>',
		},
	}

	const mockSMTPConfig = {
		host: 'smtp.example.com',
		port: 587,
		user: 'user@example.com',
		pass: 'password',
		secure: false,
	}

	test('should send email successfully to multiple recipients', async () => {
		const mockSendMail = vi.fn().mockResolvedValue({
			messageId: 'test-message-id',
			accepted: mockMail.toAddresses,
			rejected: [],
		})

		const mockTransporter = {
			sendMail: mockSendMail,
			close: vi.fn(),
		} as unknown as Transporter

		mockNodemailer.createTransport.mockReturnValue(mockTransporter)

		const result = await sendEmailWithSMTP(mockMail, mockSMTPConfig)

		expect(mockNodemailer.createTransport).toHaveBeenCalledWith({
			host: mockSMTPConfig.host,
			port: mockSMTPConfig.port,
			secure: mockSMTPConfig.secure,
			auth: {
				user: mockSMTPConfig.user,
				pass: mockSMTPConfig.pass,
			},
			pool: true,
			maxConnections: 5,
			maxMessages: 100,
		})

		expect(mockSendMail).toHaveBeenCalledWith({
			from: '=?UTF-8?Q?INIAD=E5=90=8C=E7=AA=93=E4=BC=9A=E3=80=8CINIALUM=E3=80=8D?= <test@example.com>',
			to: mockMail.toAddresses,
			subject: mockMail.subject,
			text: mockMail.body.text,
			html: mockMail.body.html,
		})

		expect(result.messageId).toBe('test-message-id')
		expect(result.accepted).toEqual(mockMail.toAddresses)
		expect(mockTransporter.close).toHaveBeenCalled()
	})

	test('should send email without HTML when html is not provided', async () => {
		const mockMailWithoutHtml: Mail = {
			...mockMail,
			body: {
				text: 'Test plain text body',
			},
		}

		const mockSendMail = vi.fn().mockResolvedValue({
			messageId: 'test-message-id',
			accepted: mockMailWithoutHtml.toAddresses,
			rejected: [],
		})

		const mockTransporter = {
			sendMail: mockSendMail,
			close: vi.fn(),
		} as unknown as Transporter

		mockNodemailer.createTransport.mockReturnValue(mockTransporter)

		await sendEmailWithSMTP(mockMailWithoutHtml, mockSMTPConfig)

		expect(mockSendMail).toHaveBeenCalledWith({
			from: '=?UTF-8?Q?INIAD=E5=90=8C=E7=AA=93=E4=BC=9A=E3=80=8CINIALUM=E3=80=8D?= <test@example.com>',
			to: mockMailWithoutHtml.toAddresses,
			subject: mockMailWithoutHtml.subject,
			text: mockMailWithoutHtml.body.text,
			html: undefined,
		})
	})

	test('should throw SMTPApiError when transporter fails', async () => {
		const mockError = new Error('SMTP connection failed')
		const mockSendMail = vi.fn().mockRejectedValue(mockError)

		const mockTransporter = {
			sendMail: mockSendMail,
			close: vi.fn(),
		} as unknown as Transporter

		mockNodemailer.createTransport.mockReturnValue(mockTransporter)

		await expect(sendEmailWithSMTP(mockMail, mockSMTPConfig)).rejects.toThrow(
			SMTPApiError,
		)

		expect(mockTransporter.close).toHaveBeenCalled()
	})

	test('should throw SMTPApiError when some recipients are rejected', async () => {
		const mockSendMail = vi.fn().mockResolvedValue({
			messageId: 'test-message-id',
			accepted: ['recipient1@example.com'],
			rejected: ['recipient2@example.com'],
		})

		const mockTransporter = {
			sendMail: mockSendMail,
			close: vi.fn(),
		} as unknown as Transporter

		mockNodemailer.createTransport.mockReturnValue(mockTransporter)

		await expect(sendEmailWithSMTP(mockMail, mockSMTPConfig)).rejects.toThrow(
			SMTPApiError,
		)

		expect(mockTransporter.close).toHaveBeenCalled()
	})

	test('should use custom SMTP settings when provided', async () => {
		const customConfig = {
			host: 'custom.smtp.com',
			port: 465,
			user: 'custom@example.com',
			pass: 'custompass',
			secure: true,
		}

		const mockSendMail = vi.fn().mockResolvedValue({
			messageId: 'test-message-id',
			accepted: mockMail.toAddresses,
			rejected: [],
		})

		const mockTransporter = {
			sendMail: mockSendMail,
			close: vi.fn(),
		} as unknown as Transporter

		mockNodemailer.createTransport.mockReturnValue(mockTransporter)

		await sendEmailWithSMTP(mockMail, customConfig)

		expect(mockNodemailer.createTransport).toHaveBeenCalledWith({
			host: customConfig.host,
			port: customConfig.port,
			secure: customConfig.secure,
			auth: {
				user: customConfig.user,
				pass: customConfig.pass,
			},
			pool: true,
			maxConnections: 5,
			maxMessages: 100,
		})
	})
})
