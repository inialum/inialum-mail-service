import { parseMigrationCliArgs } from './r2KeyMigrationCli'

describe('parseMigrationCliArgs', () => {
	test('should reject unknown options instead of treating them as valued flags', () => {
		expect(() =>
			parseMigrationCliArgs(['--en', 'staging', '--apply'], {}),
		).toThrow('Unknown option: --en')
	})

	test('should reject non-integer --limit values', () => {
		expect(() => parseMigrationCliArgs(['--limit', '1.5'], {})).toThrow(
			'--limit must be a positive integer',
		)
		expect(() => parseMigrationCliArgs(['--limit', '0'], {})).toThrow(
			'--limit must be a positive integer',
		)
	})

	test('should parse known options and default environment to production', () => {
		expect(parseMigrationCliArgs(['--apply', '--limit', '10'], {})).toEqual({
			environment: 'production',
			accountId: '',
			accessKeyId: '',
			secretAccessKey: '',
			bucketName: '',
			apply: true,
			deleteSource: false,
			overwrite: false,
			limit: 10,
			cursor: undefined,
			jurisdiction: undefined,
		})
	})
})
