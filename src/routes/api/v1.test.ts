import { type ZodError } from 'zod'

import { sendEmailWithSES } from '@/lib/mail/ses'

import { apiV1 } from './v1'

vi.mock('@/lib/mail/ses', () => {
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
      body: JSON.stringify({
        to: 'test@expmle.com',
        subject: 'Test',
        body: 'This is a test mail.',
      }),
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
        to: '.test@expmle.com',
        body: 'This is a test mail.',
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
      ] as ZodError['issues'],
    })
  })
})
