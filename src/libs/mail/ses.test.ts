import {
  SESv2Client,
  type SESv2ClientConfig,
  SendEmailCommand,
} from '@aws-sdk/client-sesv2'
import { mockClient } from 'aws-sdk-client-mock'

import { SESApiError } from '@/libs/error/applicationErrors'

import { type Mail } from '@/types/Mail'

import { sendEmailWithSES } from './ses'

const SESv2Mock = mockClient(SESv2Client)
beforeEach(() => {
  SESv2Mock.reset()
})

describe('sendEmailWithSES', () => {
  const mailConfig: Mail = {
    fromAddress: 'test@example.com',
    toAddress: 'to@example.com',
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

  test('Should throw SESApiError', async () => {
    SESv2Mock.on(SendEmailCommand).resolves({
      $metadata: {
        httpStatusCode: 500,
      },
    })

    await expect(() =>
      sendEmailWithSES(mailConfig, credentials),
    ).rejects.toThrowError(new SESApiError('Failed to send email via SES'))
  })
})
