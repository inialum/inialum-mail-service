export type MailHeader = {
	name: string
	value: string
}

export type Mail = {
	fromAddress: string
	toAddresses: string[]
	subject: string
	body: {
		text: string
		html?: string
	}
	headers?: MailHeader[]
}
