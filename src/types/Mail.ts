export type Mail = {
	fromAddress: string
	toAddresses: string[]
	subject: string
	body: {
		text: string
		html?: string
	}
}
