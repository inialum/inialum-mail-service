import type { Context } from 'hono'
import {
	type IdempotencyStore,
	idempotency,
	type ProblemDetail,
} from 'hono-idempotency'

import {
	IDEMPOTENCY_MAX_KEY_LENGTH,
	IDEMPOTENCY_RETRY_AFTER_SECONDS,
} from '../../constants/idempotency'
import { CreateDistributionApiRequestSchemaV1 } from '../api/v1/schema/distributions'
import { SendApiRequestSchemaV1 } from '../api/v1/schema/send'
import { hashDistributionPayload } from '../distribution/payloadHash'
import { hashSendPayload } from './payloadHash'

const hashRawBody = async (raw: string): Promise<string> => {
	const digest = await crypto.subtle.digest(
		'SHA-256',
		new TextEncoder().encode(raw),
	)
	return [...new Uint8Array(digest)]
		.map((byte) => byte.toString(16).padStart(2, '0'))
		.join('')
}

const fingerprintSendBody = async (c: Context): Promise<string> => {
	const raw = await c.req.text()
	try {
		const parsed = SendApiRequestSchemaV1.safeParse(JSON.parse(raw))
		if (parsed.success) {
			return hashSendPayload(parsed.data)
		}
	} catch {
		// The route validator returns the public 400 response after the lock is taken.
	}
	return hashRawBody(raw)
}

const onIdempotencyError = (error: ProblemDetail, c: Context) => {
	if (error.code === 'CONFLICT') {
		c.header('Retry-After', String(IDEMPOTENCY_RETRY_AFTER_SECONDS))
		return c.json(
			{
				error: 'idempotency_in_progress' as const,
				message: 'A request with this Idempotency-Key is already in progress',
			},
			409,
		)
	}

	if (error.code === 'FINGERPRINT_MISMATCH') {
		return c.json(
			{
				error: 'idempotency_payload_mismatch' as const,
				message: 'Idempotency-Key was reused with a different request payload',
			},
			422,
		)
	}

	return c.json(
		{
			error: error.code,
			message: error.detail,
		},
		error.status as 400 | 413,
	)
}

const fingerprintDistributionBody = async (c: Context): Promise<string> => {
	const raw = await c.req.text()
	try {
		const parsed = CreateDistributionApiRequestSchemaV1.safeParse(
			JSON.parse(raw),
		)
		if (parsed.success) {
			return hashDistributionPayload(parsed.data)
		}
	} catch {
		// The route validator returns the public 400 response after the lock is taken.
	}
	return hashRawBody(raw)
}

export const createSendIdempotencyMiddleware = (store: IdempotencyStore) =>
	idempotency({
		store,
		required: false,
		methods: ['POST'],
		maxKeyLength: IDEMPOTENCY_MAX_KEY_LENGTH,
		fingerprint: fingerprintSendBody,
		onError: onIdempotencyError,
		// Keys are caller-namespaced (e.g. invitation:{id}:g{n}); API is JWT-gated.
		dangerouslyAllowGlobalKeys: true,
	})

export const createDistributionIdempotencyMiddleware = (
	store: IdempotencyStore,
) =>
	idempotency({
		store,
		required: true,
		methods: ['POST'],
		maxKeyLength: IDEMPOTENCY_MAX_KEY_LENGTH,
		fingerprint: fingerprintDistributionBody,
		onError: onIdempotencyError,
		dangerouslyAllowGlobalKeys: true,
	})
