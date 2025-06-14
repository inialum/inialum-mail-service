import { encodeWord } from 'libmime'

import sgMail, { ResponseError, type MailDataRequired } from '@sendgrid/mail'

import { DEFAULT_MAIL_FROM_NAME } from '@/constants/mail'

import { SendGridApiError } from '@/libs/error/applicationErrors'

import type { Mail } from '@/types/Mail'

export const sendEmailWithSendGrid = async (
	{ fromAddress, toAddresses, subject, body: { text, html } }: Mail,
	token: string,
) => {
	const from = `${encodeWord(DEFAULT_MAIL_FROM_NAME)} <${fromAddress}>`

	const params: MailDataRequired = {
		to: toAddresses,
		from,
		subject,
		text,
		html,
	}

	try {
		sgMail.setApiKey(token)
		const response = await sgMail.sendMultiple(params)
		return response
	} catch (error) {
		throw new SendGridApiError(
			error instanceof ResponseError
				? error.message
				: `Failed to send email via SendGrid\nTo: ${toAddresses.join(', ')}`,
			{
				cause: error,
			},
		)
	}
}
