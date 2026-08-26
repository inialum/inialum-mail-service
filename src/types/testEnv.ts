import type { Bindings } from './Bindings'
import { env } from 'cloudflare:test'

export type TestEnv = Bindings & {
	TEST_MIGRATIONS: Array<{ name: string; queries: string[] }>
}

export const testEnv = env as unknown as TestEnv
