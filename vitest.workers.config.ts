import {
	cloudflareTest,
	readD1Migrations,
} from '@cloudflare/vitest-pool-workers'
import { defineProject } from 'vitest/config'

const migrations = await readD1Migrations('./migrations')

export default defineProject({
	plugins: [
		cloudflareTest({
			main: './src/index.ts',
			remoteBindings: false,
			wrangler: {
				configPath: './wrangler.json',
			},
			miniflare: {
				bindings: {
					ENVIRONMENT: 'test',
					TOKEN_SECRET: 'test-token-secret',
					ERROR_NOTIFICATION_TOKEN: 'test-error-notification-token',
					AWS_ACCESS_KEY_ID: 'test-access-key-id',
					AWS_SECRET_ACCESS_KEY: 'test-secret-access-key',
					BACKFILL_DRY_RUN: 'true',
					UNSUBSCRIBE_BASE_URL: 'http://localhost:8080/unsubscribe/one-click',
					TEST_MIGRATIONS: migrations,
				},
			},
		}),
	],
	test: {
		name: 'workers',
		globals: true,
		include: ['src/**/*.workers.test.ts'],
	},
})
