import {
	SESv2Client,
	type SESv2ClientConfig,
	SendEmailCommand,
	type SendEmailCommandInput,
} from '@aws-sdk/client-sesv2'
import { encodeWord } from 'libmime'

import { DEFAULT_AWS_REGION } from '../../constants/aws'
import { DEFAULT_MAIL_FROM_NAME } from '../../constants/mail'
import type { Mail } from '../../types/Mail'
import { SESApiError } from '../error/applicationErrors'

export type SendEmailWithSESOptions = {
	region?: string
	/**
	 * AWS SDK maxAttempts (includes the initial attempt).
	 * Omit to keep the SDK default (typically 3).
	 * Queue consumer must pass 1 on Workers Free.
	 */
	maxAttempts?: number
}

export const buildSesClientConfig = (
	credentials: SESv2ClientConfig['credentials'],
	endpoint: string | undefined,
	options: SendEmailWithSESOptions = {},
): SESv2ClientConfig => ({
	endpoint,
	region: options.region ?? DEFAULT_AWS_REGION,
	credentials,
	...(typeof options.maxAttempts === 'number'
		? { maxAttempts: options.maxAttempts }
		: {}),
})

export const sendEmailWithSES = async (
	{ fromAddress, toAddresses, subject, body }: Mail,
	credentials: SESv2ClientConfig['credentials'],
	endpoint?: string,
	options: SendEmailWithSESOptions = {},
) => {
	const from = `${encodeWord(DEFAULT_MAIL_FROM_NAME)} <${fromAddress}>`

	const toAddress = toAddresses[0]

	const params: SendEmailCommandInput = {
		Content: {
			Simple: {
				Body: {
					Text: {
						Data: body.text,
						Charset: 'UTF-8',
					},
					Html: body.html
						? {
								Data: body.html,
								Charset: 'UTF-8',
							}
						: undefined,
				},
				Subject: {
					Data: subject,
					Charset: 'UTF-8',
				},
			},
		},
		Destination: {
			ToAddresses: [toAddress],
		},
		FromEmailAddress: from,
		ReplyToAddresses: [from],
	}

	try {
		const client = new SESv2Client(
			buildSesClientConfig(credentials, endpoint, options),
		)
		const command = new SendEmailCommand(params)
		const res = await client.send(command)
		if (!res.$metadata.httpStatusCode || res.$metadata.httpStatusCode !== 200) {
			throw new SESApiError(
				`Failed to send email via SES\ntoAddress: ${toAddress}`,
			)
		}
		return res
	} catch (error) {
		throw new SESApiError(
			error instanceof Error
				? error.message
				: `Unexpected error occurred while sending email via SES\ntoAddress: ${toAddress}`,
			{
				cause: error,
			},
		)
	}
}
