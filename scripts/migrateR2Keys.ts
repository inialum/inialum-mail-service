import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import {
	DeleteObjectCommand,
	GetObjectCommand,
	HeadObjectCommand,
	ListObjectsV2Command,
	PutObjectCommand,
	S3Client,
} from '@aws-sdk/client-s3'

import { migrateLegacyObjectKeys } from '../src/libs/mail/r2KeyMigration'

type MigrationCliOptions = {
	environment: string
	accountId: string
	accessKeyId: string
	secretAccessKey: string
	bucketName: string
	apply: boolean
	deleteSource: boolean
	overwrite: boolean
	limit: number
	cursor?: string
	jurisdiction?: string
}

type WranglerConfig = {
	r2_buckets?: Array<{
		bucket_name: string
	}>
	env?: Record<
		string,
		{
			r2_buckets?: Array<{
				bucket_name: string
			}>
		}
	>
}

const HELP_TEXT = `Usage:
  pnpm run migrate:r2-keys -- [options]

Options:
  --env <name>              Target environment. Defaults to ENVIRONMENT or production.
  --bucket <name>           R2 bucket name. Defaults to wrangler.json binding for the environment.
  --account-id <id>         Cloudflare account ID. Defaults to CLOUDFLARE_ACCOUNT_ID.
  --access-key-id <id>      R2 access key ID. Defaults to R2_ACCESS_KEY_ID or AWS_ACCESS_KEY_ID.
  --secret-access-key <key> R2 secret access key. Defaults to R2_SECRET_ACCESS_KEY or AWS_SECRET_ACCESS_KEY.
  --jurisdiction <name>     Optional R2 jurisdiction, for example eu.
  --apply                   Copy objects to the new key structure.
  --delete-source           Delete legacy keys after a successful copy. Requires --apply.
  --overwrite               Overwrite existing target keys.
  --limit <number>          Process up to this many legacy objects. Defaults to 100.
  --cursor <cursor>         Continue from a previous cursor.
  --help                    Show this message.
`

const parseArgs = (argv: string[]): MigrationCliOptions | null => {
	const args = [...argv]
	const flags = new Map<string, string | boolean>()

	while (args.length > 0) {
		const arg = args.shift()
		if (!arg) {
			continue
		}

		if (arg === '--help') {
			return null
		}

		if (
			arg === '--apply' ||
			arg === '--delete-source' ||
			arg === '--overwrite'
		) {
			flags.set(arg, true)
			continue
		}

		const value = args.shift()
		if (!value) {
			throw new Error(`Missing value for ${arg}`)
		}
		flags.set(arg, value)
	}

	const environment =
		(flags.get('--env') as string | undefined) ??
		process.env.ENVIRONMENT ??
		'production'
	const apply = Boolean(flags.get('--apply'))
	const deleteSource = Boolean(flags.get('--delete-source'))
	if (deleteSource && !apply) {
		throw new Error('--delete-source requires --apply')
	}

	const limitRaw = (flags.get('--limit') as string | undefined) ?? '100'
	const limit = Number(limitRaw)
	if (!Number.isFinite(limit) || limit <= 0) {
		throw new Error('--limit must be a positive number')
	}

	return {
		environment,
		accountId:
			(flags.get('--account-id') as string | undefined) ??
			process.env.CLOUDFLARE_ACCOUNT_ID ??
			'',
		accessKeyId:
			(flags.get('--access-key-id') as string | undefined) ??
			process.env.R2_ACCESS_KEY_ID ??
			process.env.AWS_ACCESS_KEY_ID ??
			'',
		secretAccessKey:
			(flags.get('--secret-access-key') as string | undefined) ??
			process.env.R2_SECRET_ACCESS_KEY ??
			process.env.AWS_SECRET_ACCESS_KEY ??
			'',
		bucketName: (flags.get('--bucket') as string | undefined) ?? '',
		apply,
		deleteSource,
		overwrite: Boolean(flags.get('--overwrite')),
		limit: Math.min(limit, 1000),
		cursor: flags.get('--cursor') as string | undefined,
		jurisdiction: flags.get('--jurisdiction') as string | undefined,
	}
}

const readWranglerBucketName = (environment: string) => {
	const configText = readFileSync(
		resolve(process.cwd(), 'wrangler.json'),
		'utf8',
	)
	const config = JSON.parse(configText) as WranglerConfig
	const envConfig =
		environment === 'production' ? undefined : config.env?.[environment]
	const bucket =
		envConfig?.r2_buckets?.[0]?.bucket_name ??
		config.r2_buckets?.[0]?.bucket_name

	if (!bucket) {
		throw new Error(
			`Could not resolve an R2 bucket from wrangler.json for ${environment}`,
		)
	}

	return bucket
}

const resolveEndpoint = (accountId: string, jurisdiction?: string) => {
	if (!accountId) {
		throw new Error('Cloudflare account ID is required')
	}

	const accountHost = jurisdiction
		? `${accountId}.${jurisdiction}.r2.cloudflarestorage.com`
		: `${accountId}.r2.cloudflarestorage.com`

	return `https://${accountHost}`
}

const assertRequiredSecrets = (options: MigrationCliOptions) => {
	if (!options.accessKeyId) {
		throw new Error('R2 access key ID is required')
	}
	if (!options.secretAccessKey) {
		throw new Error('R2 secret access key is required')
	}
}

const isNotFoundError = (error: unknown) => {
	if (!(error instanceof Error)) {
		return false
	}

	return (
		error.name === 'NotFound' ||
		error.name === 'NoSuchKey' ||
		(error as Error & { $metadata?: { httpStatusCode?: number } }).$metadata
			?.httpStatusCode === 404
	)
}

const getR2HttpMetadata = (httpMetadata?: Headers | R2HTTPMetadata) => {
	if (!httpMetadata || httpMetadata instanceof Headers) {
		return undefined
	}

	return httpMetadata
}

const normalizePutBody = (
	value: string | ReadableStream | ArrayBuffer | ArrayBufferView | Blob | null,
) => {
	if (value === null) {
		return ''
	}
	if (typeof value === 'string') {
		return value
	}
	if (value instanceof ArrayBuffer) {
		return new Uint8Array(value)
	}
	if (ArrayBuffer.isView(value)) {
		return new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
	}
	if (value instanceof Blob) {
		return value
	}

	throw new Error(
		'ReadableStream payloads are not supported by the CLI migration tool',
	)
}

const createBucketAdapter = (
	client: S3Client,
	bucketName: string,
): Parameters<typeof migrateLegacyObjectKeys>[0] => ({
	list: async (options = {}) => {
		const { prefix, cursor, limit } = options
		const response = await client.send(
			new ListObjectsV2Command({
				Bucket: bucketName,
				Prefix: prefix,
				ContinuationToken: cursor,
				MaxKeys: limit,
			}),
		)

		const objects = (response.Contents ?? [])
			.map((object) => object.Key)
			.filter((key): key is string => Boolean(key))
			.map((key) => ({ key }) as R2Object)
		const delimitedPrefixes = (response.CommonPrefixes ?? [])
			.map((entry) => entry.Prefix)
			.filter((prefix): prefix is string => Boolean(prefix))

		if (response.IsTruncated && !response.NextContinuationToken) {
			throw new Error(
				'R2 listing response was truncated without a continuation token',
			)
		}
		const nextCursor = response.NextContinuationToken

		return response.IsTruncated && nextCursor
			? {
					objects,
					delimitedPrefixes,
					truncated: true,
					cursor: nextCursor,
				}
			: {
					objects,
					delimitedPrefixes,
					truncated: false,
				}
	},
	head: async (key) => {
		try {
			await client.send(
				new HeadObjectCommand({
					Bucket: bucketName,
					Key: key,
				}),
			)

			return {
				key,
			} as R2Object
		} catch (error) {
			if (isNotFoundError(error)) {
				return null
			}
			throw error
		}
	},
	get: async (key) => {
		try {
			const response = await client.send(
				new GetObjectCommand({
					Bucket: bucketName,
					Key: key,
				}),
			)
			if (!response.Body) {
				throw new Error(`R2 object body was empty: ${key}`)
			}
			const responseBody = response.Body

			return {
				text: async () => responseBody.transformToString(),
				httpMetadata: {
					contentType: response.ContentType,
					contentLanguage: response.ContentLanguage,
					contentDisposition: response.ContentDisposition,
					contentEncoding: response.ContentEncoding,
					cacheControl: response.CacheControl,
				},
				customMetadata: response.Metadata,
			} as R2ObjectBody
		} catch (error) {
			if (isNotFoundError(error)) {
				return null
			}
			throw error
		}
	},
	put: async (key, value, options) => {
		const httpMetadata = getR2HttpMetadata(options?.httpMetadata)

		await client.send(
			new PutObjectCommand({
				Bucket: bucketName,
				Key: key,
				Body: normalizePutBody(value),
				ContentType: httpMetadata?.contentType,
				ContentLanguage: httpMetadata?.contentLanguage,
				ContentDisposition: httpMetadata?.contentDisposition,
				ContentEncoding: httpMetadata?.contentEncoding,
				CacheControl: httpMetadata?.cacheControl,
				Metadata: options?.customMetadata,
			}),
		)

		return {
			key,
		} as R2Object
	},
	delete: async (keys) => {
		const normalized = Array.isArray(keys) ? keys : [keys]
		for (const key of normalized) {
			await client.send(
				new DeleteObjectCommand({
					Bucket: bucketName,
					Key: key,
				}),
			)
		}
	},
})

const main = async () => {
	const options = parseArgs(process.argv.slice(2))
	if (!options) {
		console.log(HELP_TEXT)
		return
	}

	assertRequiredSecrets(options)
	const bucketName =
		options.bucketName || readWranglerBucketName(options.environment)
	const endpoint = resolveEndpoint(options.accountId, options.jurisdiction)
	const client = new S3Client({
		region: 'auto',
		endpoint,
		credentials: {
			accessKeyId: options.accessKeyId,
			secretAccessKey: options.secretAccessKey,
		},
	})

	const result = await migrateLegacyObjectKeys(
		createBucketAdapter(client, bucketName),
		options.environment,
		{
			apply: options.apply,
			deleteSource: options.deleteSource,
			overwrite: options.overwrite,
			limit: options.limit,
			cursor: options.cursor,
		},
	)

	console.log(
		JSON.stringify(
			{
				...result,
				bucketName,
				endpoint,
			},
			null,
			2,
		),
	)
}

void main().catch((error) => {
	console.error(error instanceof Error ? error.message : String(error))
	process.exitCode = 1
})
