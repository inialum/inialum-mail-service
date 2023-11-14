import { OpenAPIHono } from '@hono/zod-openapi'
import { env } from 'hono/adapter'
import { jwt } from 'hono/jwt'

import { api } from '@/routes/api'

const app = new OpenAPIHono()

app.use('/api/*', async (c, next) => {
  const { TOKEN_SECRET } = env<{ TOKEN_SECRET: string }>(c)
  const auth = jwt({
    secret: TOKEN_SECRET,
  })
  return await auth(c, next)
})

app.get('/', (c) => c.text('Hello Hono!'))
app.route('/api', api)
app.doc('/docs/v1', {
  openapi: '3.0.0',
  info: {
    version: '1.0.0',
    title: 'INIALUM Mail Service API v1',
  },
})

export default app
