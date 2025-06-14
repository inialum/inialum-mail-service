export function assertIsDefined<T>(arg: T): asserts arg is NonNullable<T> {
	if (arg === undefined || arg === null) {
		throw new Error(
			`Expected 'arg' to be defined, but received ${String(arg)}.`,
		)
	}
}
