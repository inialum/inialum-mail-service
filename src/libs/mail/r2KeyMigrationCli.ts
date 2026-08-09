export type MigrationCliOptions = {
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

const BOOLEAN_FLAGS = new Set(['--apply', '--delete-source', '--overwrite'])

const VALUE_FLAGS = new Set([
	'--env',
	'--bucket',
	'--account-id',
	'--access-key-id',
	'--secret-access-key',
	'--jurisdiction',
	'--limit',
	'--cursor',
])

const isPositiveInteger = (value: string) => /^[1-9]\d*$/.test(value)

export const parseMigrationCliArgs = (
	argv: string[],
	env: NodeJS.ProcessEnv = process.env,
): MigrationCliOptions | null => {
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

		if (BOOLEAN_FLAGS.has(arg)) {
			flags.set(arg, true)
			continue
		}

		if (!VALUE_FLAGS.has(arg)) {
			throw new Error(`Unknown option: ${arg}`)
		}

		const value = args.shift()
		if (!value || value.startsWith('--')) {
			throw new Error(`Missing value for ${arg}`)
		}
		flags.set(arg, value)
	}

	const environment =
		(flags.get('--env') as string | undefined) ??
		env.ENVIRONMENT ??
		'production'
	const apply = Boolean(flags.get('--apply'))
	const deleteSource = Boolean(flags.get('--delete-source'))
	if (deleteSource && !apply) {
		throw new Error('--delete-source requires --apply')
	}

	const limitRaw = (flags.get('--limit') as string | undefined) ?? '100'
	if (!isPositiveInteger(limitRaw)) {
		throw new Error('--limit must be a positive integer')
	}
	const limit = Number(limitRaw)

	return {
		environment,
		accountId:
			(flags.get('--account-id') as string | undefined) ??
			env.CLOUDFLARE_ACCOUNT_ID ??
			'',
		accessKeyId:
			(flags.get('--access-key-id') as string | undefined) ??
			env.R2_ACCESS_KEY_ID ??
			'',
		secretAccessKey:
			(flags.get('--secret-access-key') as string | undefined) ??
			env.R2_SECRET_ACCESS_KEY ??
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
