import { Hono } from 'hono'

import { api } from './api'

export const root = new Hono()
root.route('/api', api)
