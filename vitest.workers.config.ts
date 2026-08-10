import { cloudflareTest } from '@cloudflare/vitest-pool-workers'
import { defineProject } from 'vitest/config'

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
