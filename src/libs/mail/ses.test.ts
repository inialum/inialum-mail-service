import {
	SESv2Client,
	type SESv2ClientConfig,
	SendEmailCommand,
} from '@aws-sdk/client-sesv2'
import { mockClient } from 'aws-sdk-client-mock'
import { beforeEach, describe, expect, test } from 'vitest'

import type { Mail } from '../../types/Mail'
import { SESApiError } from '../error/applicationErrors'
import { buildSesClientConfig, sendEmailWithSES } from './ses'

const SESv2Mock = mockClient(SESv2Client)
beforeEach(() => {
	SESv2Mock.reset()
})

describe('buildSesClientConfig', () => {
	const credentials: SESv2ClientConfig['credentials'] = {
		accessKeyId: 'dummyKey',
		secretAccessKey: 'dummySecret',
	}

	test('sets maxAttempts when provided for the queue consumer', () => {
		expect(
			buildSesClientConfig(credentials, undefined, { maxAttempts: 1 }),
		).toEqual(
			expect.objectContaining({
				maxAttempts: 1,
			}),
		)
	})

	test('omits maxAttempts so single-send keeps the SDK default retry contract', () => {
		expect(buildSesClientConfig(credentials, undefined)).not.toHaveProperty(
			'maxAttempts',
		)
	})
})

describe('sendEmailWithSES', () => {
	const mailConfig: Mail = {
		fromAddress: 'test@example.com',
		toAddresses: ['to@example.com'],
		subject: 'Test',
		body: {
			text: 'Hello world',
			html: '<p>Hello World!</p>',
		},
	}

	const credentials: SESv2ClientConfig['credentials'] = {
		accessKeyId: 'dummyKey',
		secretAccessKey: 'dummySecret',
	}

	test('Should send mail via SES with no errors', async () => {
		SESv2Mock.on(SendEmailCommand).resolves({
			$metadata: {
				httpStatusCode: 200,
			},
		})
		const result = await sendEmailWithSES(mailConfig, credentials)

		expect(result).toStrictEqual({
			$metadata: {
				httpStatusCode: 200,
			},
		})
	})

	test('attaches List-Unsubscribe headers on Content.Simple', async () => {
		SESv2Mock.on(SendEmailCommand).resolves({
			$metadata: {
				httpStatusCode: 200,
			},
		})

		await sendEmailWithSES(
			{
				...mailConfig,
				headers: [
					{
						name: 'List-Unsubscribe',
						value: '<https://inialum.org/unsubscribe/one-click?token=abc>',
					},
					{
						name: 'List-Unsubscribe-Post',
						value: 'List-Unsubscribe=One-Click',
					},
				],
			},
			credentials,
		)

		const command = SESv2Mock.call(0).args[0] as SendEmailCommand
		expect(command.input.Content?.Simple?.Headers).toEqual([
			{
				Name: 'List-Unsubscribe',
				Value: '<https://inialum.org/unsubscribe/one-click?token=abc>',
			},
			{
				Name: 'List-Unsubscribe-Post',
				Value: 'List-Unsubscribe=One-Click',
			},
		])
	})

	test('passes an abort signal to the AWS SDK request', async () => {
		SESv2Mock.on(SendEmailCommand).resolves({
			$metadata: { httpStatusCode: 200 },
		})
		const abortController = new AbortController()

		await sendEmailWithSES(mailConfig, credentials, undefined, {
			abortSignal: abortController.signal,
		})

		const sendArgs = SESv2Mock.calls()[0]?.args as unknown[]
		expect(sendArgs[1]).toEqual({
			abortSignal: abortController.signal,
		})
	})

	test('Should throw SESApiError', async () => {
		SESv2Mock.on(SendEmailCommand).resolves({
			$metadata: {
				httpStatusCode: 500,
			},
		})

		await expect(() =>
			sendEmailWithSES(mailConfig, credentials),
		).rejects.toThrowError(
			new SESApiError(
				'Failed to send email via SES\ntoAddress: to@example.com',
			),
		)
	})
})
