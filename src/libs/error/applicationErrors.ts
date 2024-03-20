/**
 * This error is thrown when SES API returns an error.
 */
export class SESApiError extends Error {
  static {
    this.prototype.name = 'SESApiError'
  }
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
  }
}
