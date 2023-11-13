import { OpenAPIHono } from '@hono/zod-openapi'

import { api } from '@/routes/api'

const app = new OpenAPIHono()
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
