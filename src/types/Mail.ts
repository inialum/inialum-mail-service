export type Mail = {
  fromAddress: string
  toAddress: string
  subject: string
  body: {
    text: string
    html?: string
  }
}
