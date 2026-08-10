import { defineConfig } from 'vitest/config'

export default defineConfig({
	test: {
		coverage: {
			provider: 'istanbul',
		},
		projects: ['./vitest.unit.config.ts', './vitest.workers.config.ts'],
	},
})
