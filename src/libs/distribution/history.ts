import { and, asc, desc, eq, gt, like, lt, lte } from 'drizzle-orm'

import {
	DEFAULT_LIST_LIMIT,
	MAX_LIST_LIMIT,
} from '../../constants/distribution'
import { createDb } from '../../db'
import { campaigns, distributions, recipients } from '../../db/schema'
import type { DistributionStatus, RecipientStatus } from '../../db/values'
import { getDistributionManifest } from '../mail/distributionStore'

export type ListDistributionsQuery = {
	cursor?: string
	limit?: number
	status?: DistributionStatus
	source?: string
	from?: string
	to?: string
	q?: string
}

const clampLimit = (limit?: number) => {
	if (!limit || Number.isNaN(limit)) {
		return DEFAULT_LIST_LIMIT
	}

	return Math.min(Math.max(1, limit), MAX_LIST_LIMIT)
}

const escapeLike = (value: string) =>
	value.replaceAll('\\', '').replaceAll('%', '').replaceAll('_', '')

export const listDistributions = async (
	database: D1Database,
	query: ListDistributionsQuery,
) => {
	const db = createDb(database)
	const limit = clampLimit(query.limit)
	const filters = []

	if (query.status) {
		filters.push(eq(distributions.status, query.status))
	}
	if (query.source) {
		filters.push(eq(distributions.source, query.source))
	}
	if (query.from) {
		filters.push(gt(distributions.createdAt, query.from))
	}
	if (query.to) {
		filters.push(lte(distributions.createdAt, query.to))
	}
	if (query.q) {
		filters.push(like(distributions.subject, `%${escapeLike(query.q)}%`))
	}
	if (query.cursor) {
		filters.push(lt(distributions.id, query.cursor))
	}

	const rows = await db
		.select()
		.from(distributions)
		.where(filters.length > 0 ? and(...filters) : undefined)
		.orderBy(desc(distributions.id))
		.limit(limit + 1)

	const hasMore = rows.length > limit
	const items = hasMore ? rows.slice(0, limit) : rows

	return {
		items,
		nextCursor: hasMore ? items.at(-1)?.id : undefined,
	}
}

export const getDistribution = async (
	database: D1Database,
	bucket: R2Bucket,
	environment: string,
	distributionId: string,
) => {
	const db = createDb(database)
	const [distribution] = await db
		.select()
		.from(distributions)
		.where(eq(distributions.id, distributionId))
		.limit(1)

	if (!distribution) {
		return null
	}

	const childCampaigns = await db
		.select()
		.from(campaigns)
		.where(eq(campaigns.distributionId, distributionId))
		.orderBy(asc(campaigns.createdAt))

	const manifest = await getDistributionManifest(
		bucket,
		environment,
		distributionId,
	)

	return {
		distribution,
		campaigns: childCampaigns,
		body: manifest?.body ?? null,
		audienceSnapshot: manifest?.audienceSnapshot ?? null,
	}
}

export const listDistributionRecipients = async (
	database: D1Database,
	distributionId: string,
	query: { cursor?: string; limit?: number; status?: RecipientStatus },
) => {
	const db = createDb(database)
	const limit = clampLimit(query.limit)
	const filters = [eq(recipients.distributionId, distributionId)]

	if (query.status) {
		filters.push(eq(recipients.status, query.status))
	}
	if (query.cursor) {
		filters.push(lt(recipients.id, query.cursor))
	}

	const rows = await db
		.select()
		.from(recipients)
		.where(and(...filters))
		.orderBy(desc(recipients.id))
		.limit(limit + 1)

	const hasMore = rows.length > limit
	const items = hasMore ? rows.slice(0, limit) : rows

	return {
		items,
		nextCursor: hasMore ? items.at(-1)?.id : undefined,
	}
}
