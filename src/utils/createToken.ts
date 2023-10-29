import { sign } from 'jws'
import '@Root/env.ts'

const payload = {
  service_name: 'inialum-mail-service',
  created_at: new Date().getTime(),
}
const secret = process.env.TOKEN_SECRET
const token = sign({
  header: {
    alg: 'HS256',
  },
  payload,
  secret,
})
console.log(`token: ${token}`)
