import { Hono } from 'hono'

import { apiV1 } from './v1'

export const api = new Hono()
api.route('/v1', apiV1)
