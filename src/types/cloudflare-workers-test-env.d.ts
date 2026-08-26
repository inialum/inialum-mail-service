import type { Bindings } from './Bindings'

declare module 'cloudflare:workers' {
	interface ProvidedEnv extends Bindings {}
}

declare module 'cloudflare:test' {
	interface ProvidedEnv extends Bindings {
		TEST_MIGRATIONS: Array<{ name: string; queries: string[] }>
	}
}
