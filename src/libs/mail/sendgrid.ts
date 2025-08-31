import sgMail, { type MailDataRequired, ResponseError } from '@sendgrid/mail'
import { encodeWord } from 'libmime'

import { DEFAULT_MAIL_FROM_NAME } from '../../constants/mail'
import type { Mail } from '../../types/Mail'
import { SendGridApiError } from '../error/applicationErrors'

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
		await sgMail.sendMultiple(params)
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
