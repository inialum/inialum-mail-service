import {
  SESv2Client,
  type SESv2ClientConfig,
  SendEmailCommand,
  type SendEmailCommandInput,
} from '@aws-sdk/client-sesv2'
import { encodeWord } from 'libmime'

import { DEFAULT_AWS_REGION } from '@/constants/aws'
import { DEFAULT_MAIL_FROM_NAME } from '@/constants/mail'

import { SESApiError } from '@/lib/errors'

import { type Mail } from '@/types/Mail'

export const sendEmailWithSES = async (
  { fromAddress, toAddress, subject, body }: Mail,
  credentials: SESv2ClientConfig['credentials'],
  region: string = DEFAULT_AWS_REGION,
) => {
  const from = `${encodeWord(DEFAULT_MAIL_FROM_NAME)} <${fromAddress}>`

  const params: SendEmailCommandInput = {
    Content: {
      Simple: {
        Body: {
          Html: {
            Data: body,
            Charset: 'UTF-8',
          },
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
      region,
      credentials,
    })
    const command = new SendEmailCommand(params)
    const res = await client.send(command)
    if (!res.$metadata.httpStatusCode || res.$metadata.httpStatusCode !== 200) {
      throw new SESApiError('Failed to send email via SES')
    }
    return res
  } catch (error) {
    throw new SESApiError(
      error instanceof Error
        ? error.message
        : 'Unexpected error occurred while sending email via SES',
      {
        cause: error,
      },
    )
  }
}