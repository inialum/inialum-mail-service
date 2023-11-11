/* eslint-disable no-console */
import { sign } from 'jws'
import '@Root/env.ts'

const payload = {
  service_name: 'inialum-mail-service',
  created_at: new Date().getTime(),
}
try {
  const secret = process.env.TOKEN_SECRET
  const token = sign({
    header: {
      alg: 'HS256',
    },
    payload,
    secret,
  })
  console.log(`token: ${token}`)
} catch (e) {
  if (e instanceof Error) {
    console.log('Failed to create token:', e.message)
  } else {
    console.log(e)
  }
}
