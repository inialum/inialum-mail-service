import {
	SESv2Client,
	type SESv2ClientConfig,
	SendEmailCommand,
	type SendEmailCommandInput,
} from '@aws-sdk/client-sesv2'
import { encodeWord } from 'libmime'

import { DEFAULT_AWS_REGION } from '@/constants/aws'
import { DEFAULT_MAIL_FROM_NAME } from '@/constants/mail'

import { SESApiError } from '@/libs/error/applicationErrors'

import type { Mail } from '@/types/Mail'

export const sendEmailWithSES = async (
	{ fromAddress, toAddresses, subject, body }: Mail,
	credentials: SESv2ClientConfig['credentials'],
	endpoint?: string,
	region: string = DEFAULT_AWS_REGION,
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
		const client = new SESv2Client({
			endpoint,
			region,
			credentials,
		})
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
