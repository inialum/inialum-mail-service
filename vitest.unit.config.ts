import { defineProject } from 'vitest/config'

export default defineProject({
	test: {
		name: 'unit',
		globals: true,
		environment: 'node',
		include: ['src/**/*.test.ts'],
		exclude: ['src/**/*.workers.test.ts'],
	},
})
