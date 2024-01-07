import { type ZodError } from 'zod'

import { type SendApiRequestV1 } from '@/libs/api/v1/schema/send'
import { sendEmailWithSES } from '@/libs/mail/ses'

import { apiV1 } from '.'

vi.mock('@/libs/mail/ses', () => {
  return {
    sendEmailWithSES: vi.fn(),
  }
})

vi.mock('hono/adapter', () => {
  return {
    env: () => getMiniflareBindings(),
  }
})

describe('API v1', () => {
  const apiBodyContent: SendApiRequestV1 = {
    from: 'noreply@mail.inialum.org',
    to: 'test@expmle.com',
    subject: 'Test',
    body: {
      text: 'This is a test mail.',
      html: '<p>Hello World!</p>',
    },
  }

  test('POST /send (should return data with no errors)', async () => {
    vi.mocked(sendEmailWithSES).mockResolvedValueOnce({
      $metadata: {
        httpStatusCode: 200,
      },
    })

    const res = await apiV1.request('/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(apiBodyContent),
    })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      status: 'ok',
    })
  })

  test('POST /send (should return with error message)', async () => {
    const res = await apiV1.request('/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'noreply@mail.inialum.org',
        to: '.test@expmle.com',
        body: { ...apiBodyContent.body, text: undefined },
      }),
    })

    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({
      message: 'Invalid request body',
      issues: [
        {
          code: 'invalid_string',
          message: 'Invalid email address',
          path: ['to'],
          validation: 'email',
        },
        {
          code: 'invalid_type',
          expected: 'string',
          message: 'This field is required',
          path: ['subject'],
          received: 'undefined',
        },
        {
          code: 'invalid_type',
          expected: 'string',
          message: 'This field is required',
          path: ['body', 'text'],
          received: 'undefined',
        },
      ] as ZodError['issues'],
    })
  })
})
