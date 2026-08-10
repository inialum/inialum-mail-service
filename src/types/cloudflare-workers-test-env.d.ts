import type { Bindings } from './Bindings'

declare module 'cloudflare:workers' {
	interface ProvidedEnv extends Bindings {}
}
