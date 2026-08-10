import { resolve } from 'node:path'

import { defineConfig } from 'vitest/config'

export default defineConfig({
	test: {
		globals: true,
		environment: 'miniflare',
		environmentOptions: {
			bindings: {
				ENVIRONMENT: 'test',
			},
		},
	},
	resolve: {
		alias: [
			{
				find: '@Root',
				replacement: resolve(__dirname, '.'),
			},
			{
				find: '@',
				replacement: resolve(__dirname, './src'),
			},
		],
	},
})
