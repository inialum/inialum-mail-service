type MailLogStatus = 'success' | 'error'

export type LegacyMigrationCategory =
	| 'campaign_state'
	| 'campaign_accepted_log'
	| 'campaign_failure_log'
	| 'mail_log'

export type LegacyMigrationPlan = {
	category: LegacyMigrationCategory
	sourceKey: string
	targetKey: string
}

export type LegacyMigrationEntry = LegacyMigrationPlan & {
	action: 'planned' | 'migrated' | 'skipped' | 'error'
	message?: string
}

export type LegacyMigrationOptions = {
	apply?: boolean
	deleteSource?: boolean
	overwrite?: boolean
	limit?: number
	cursor?: string
}

export type LegacyMigrationResult = {
	environment: string
	prefix: string
	apply: boolean
	deleteSource: boolean
	overwrite: boolean
	processed: number
	planned: number
	migrated: number
	deleted: number
	skipped: number
	errors: number
	nextCursor: string | null
	hasMore: boolean
	entries: LegacyMigrationEntry[]
}

type JsonR2ObjectBody = Pick<
	R2ObjectBody,
	'text' | 'httpMetadata' | 'customMetadata'
>

type JsonR2Bucket = Pick<R2Bucket, 'list' | 'head' | 'get' | 'put' | 'delete'>

const LEGACY_STATE_KEY_RE =
	/^(?<environment>[^/]+)\/multiple\/campaigns\/(?<campaignId>[^/]+)\/(?:(?<leaf>manifest|status)\.json|chunks\/(?<chunkIndex>\d+)\.json)$/

const LEGACY_ACCEPTED_LOG_KEY_RE =
	/^(?<environment>[^/]+)\/multiple\/campaigns\/(?<date>\d{4}-\d{2}-\d{2})\/(?<campaignId>[^/]+)\.json$/

const LEGACY_FAILURE_LOG_KEY_RE =
	/^(?<environment>[^/]+)\/multiple\/failures\/(?<date>\d{4}-\d{2}-\d{2})\/(?<fileName>[^/]+\.json)$/

const LEGACY_MAIL_LOG_KEY_RE =
	/^(?<environment>[^/]+)\/multiple\/(?<date>\d{4}-\d{2}-\d{2})\/(?<fileName>[^/]+\.json)$/

const isMailLogStatus = (value: unknown): value is MailLogStatus =>
	value === 'success' || value === 'error'

const getRequiredGroup = (
	match: RegExpMatchArray,
	groupName: string,
	sourceKey: string,
) => {
	const value = match.groups?.[groupName]
	if (!value) {
		throw new Error(`Missing ${groupName} in legacy key: ${sourceKey}`)
	}

	return value
}

export const parseLegacyMailLogStatus = (
	payloadText: string,
): MailLogStatus => {
	const parsed = JSON.parse(payloadText) as { status?: unknown }
	if (!isMailLogStatus(parsed.status)) {
		throw new Error('Legacy mail log payload does not include a valid status')
	}

	return parsed.status
}

export const planLegacyObjectMigration = (
	sourceKey: string,
	mailLogStatus?: MailLogStatus,
): LegacyMigrationPlan | null => {
	const stateMatch = sourceKey.match(LEGACY_STATE_KEY_RE)
	if (stateMatch) {
		const environment = getRequiredGroup(stateMatch, 'environment', sourceKey)
		const campaignId = getRequiredGroup(stateMatch, 'campaignId', sourceKey)
		const leaf = stateMatch.groups?.leaf
		const chunkIndex = stateMatch.groups?.chunkIndex

		const targetSuffix =
			leaf === 'manifest' || leaf === 'status'
				? `${leaf}.json`
				: `chunks/${chunkIndex}.json`

		return {
			category: 'campaign_state',
			sourceKey,
			targetKey: `${environment}/state/campaigns/${campaignId}/${targetSuffix}`,
		}
	}

	const acceptedMatch = sourceKey.match(LEGACY_ACCEPTED_LOG_KEY_RE)
	if (acceptedMatch) {
		const environment = getRequiredGroup(
			acceptedMatch,
			'environment',
			sourceKey,
		)
		const date = getRequiredGroup(acceptedMatch, 'date', sourceKey)
		const campaignId = getRequiredGroup(acceptedMatch, 'campaignId', sourceKey)

		return {
			category: 'campaign_accepted_log',
			sourceKey,
			targetKey: `${environment}/logs/campaigns/accepted/${date}/${campaignId}.json`,
		}
	}

	const failureMatch = sourceKey.match(LEGACY_FAILURE_LOG_KEY_RE)
	if (failureMatch) {
		const environment = getRequiredGroup(failureMatch, 'environment', sourceKey)
		const date = getRequiredGroup(failureMatch, 'date', sourceKey)
		const fileName = getRequiredGroup(failureMatch, 'fileName', sourceKey)

		return {
			category: 'campaign_failure_log',
			sourceKey,
			targetKey: `${environment}/logs/campaigns/failures/${date}/${fileName}`,
		}
	}

	const mailLogMatch = sourceKey.match(LEGACY_MAIL_LOG_KEY_RE)
	if (mailLogMatch) {
		if (!mailLogStatus) {
			throw new Error('Legacy mail log migration requires a resolved status')
		}

		const environment = getRequiredGroup(mailLogMatch, 'environment', sourceKey)
		const date = getRequiredGroup(mailLogMatch, 'date', sourceKey)
		const fileName = getRequiredGroup(mailLogMatch, 'fileName', sourceKey)

		return {
			category: 'mail_log',
			sourceKey,
			targetKey: `${environment}/logs/mail/${mailLogStatus}/${date}/${fileName}`,
		}
	}

	return null
}

const readLegacyObject = async (bucket: JsonR2Bucket, sourceKey: string) => {
	const object = await bucket.get(sourceKey)
	if (!object) {
		throw new Error(`Legacy object not found: ${sourceKey}`)
	}

	return object
}

const buildMigrationPlan = async (
	bucket: JsonR2Bucket,
	sourceKey: string,
): Promise<{
	plan: LegacyMigrationPlan | null
	sourceObject?: JsonR2ObjectBody
	sourceText?: string
}> => {
	if (!LEGACY_MAIL_LOG_KEY_RE.test(sourceKey)) {
		return {
			plan: planLegacyObjectMigration(sourceKey),
		}
	}

	const sourceObject = await readLegacyObject(bucket, sourceKey)
	const sourceText = await sourceObject.text()
	const plan = planLegacyObjectMigration(
		sourceKey,
		parseLegacyMailLogStatus(sourceText),
	)

	return {
		plan,
		sourceObject,
		sourceText,
	}
}

export const migrateLegacyObjectKeys = async (
	bucket: JsonR2Bucket,
	environment: string,
	options: LegacyMigrationOptions = {},
): Promise<LegacyMigrationResult> => {
	const apply = options.apply ?? false
	const deleteSource = options.deleteSource ?? false
	const overwrite = options.overwrite ?? false
	const limit = options.limit ?? 100
	const prefix = `${environment}/multiple/`
	const listing = await bucket.list({
		prefix,
		cursor: options.cursor,
		limit,
	})

	const result: LegacyMigrationResult = {
		environment,
		prefix,
		apply,
		deleteSource,
		overwrite,
		processed: 0,
		planned: 0,
		migrated: 0,
		deleted: 0,
		skipped: 0,
		errors: 0,
		nextCursor: listing.truncated ? listing.cursor : null,
		hasMore: listing.truncated,
		entries: [],
	}

	for (const object of listing.objects) {
		result.processed += 1

		try {
			const {
				plan,
				sourceObject: plannedSourceObject,
				sourceText,
			} = await buildMigrationPlan(bucket, object.key)

			if (!plan) {
				result.skipped += 1
				result.entries.push({
					action: 'skipped',
					category: 'campaign_state',
					sourceKey: object.key,
					targetKey: object.key,
					message: 'Key does not match a legacy mail-service pattern',
				})
				continue
			}

			if (!apply) {
				result.planned += 1
				result.entries.push({
					...plan,
					action: 'planned',
				})
				continue
			}

			const targetObject = await bucket.head(plan.targetKey)
			if (targetObject && !overwrite && !deleteSource) {
				result.skipped += 1
				result.entries.push({
					...plan,
					action: 'skipped',
					message: 'Target already exists',
				})
				continue
			}

			const sourceObject =
				plannedSourceObject ?? (await readLegacyObject(bucket, object.key))
			const payload = sourceText ?? (await sourceObject.text())

			if (targetObject && !overwrite && deleteSource) {
				const existingTarget = await bucket.get(plan.targetKey)
				if (!existingTarget) {
					throw new Error(`Target object disappeared: ${plan.targetKey}`)
				}
				const existingPayload = await existingTarget.text()
				if (existingPayload !== payload) {
					result.errors += 1
					result.entries.push({
						...plan,
						action: 'error',
						message:
							'Target already exists but does not match the legacy object',
					})
					continue
				}

				await bucket.delete(plan.sourceKey)
				result.deleted += 1
				result.entries.push({
					...plan,
					action: 'migrated',
					message: 'Target already exists and matches; deleted the legacy key',
				})
				continue
			}

			await bucket.put(plan.targetKey, payload, {
				httpMetadata: sourceObject.httpMetadata,
				customMetadata: sourceObject.customMetadata,
			})

			if (deleteSource) {
				await bucket.delete(plan.sourceKey)
				result.deleted += 1
			}

			result.migrated += 1
			result.entries.push({
				...plan,
				action: 'migrated',
				message: deleteSource
					? 'Copied to the new key and deleted the legacy key'
					: 'Copied to the new key',
			})
		} catch (error) {
			result.errors += 1
			result.entries.push({
				action: 'error',
				category: 'campaign_state',
				sourceKey: object.key,
				targetKey: object.key,
				message: error instanceof Error ? error.message : String(error),
			})
		}
	}

	return result
}
