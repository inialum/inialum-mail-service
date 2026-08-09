/**
 * Detect Cloudflare Workers Free external-subrequest budget exhaustion.
 * Message text is matched across the error cause chain (e.g. SESApiError wrappers).
 */
export const isInvocationBudgetExhaustedError = (error: unknown): boolean => {
	const texts: string[] = []
	let current: unknown = error

	while (current instanceof Error) {
		texts.push(current.name, current.message)
		current = current.cause
	}

	if (typeof current === 'string') {
		texts.push(current)
	}

	return texts.some((text) => /too many subrequests/i.test(text))
}
