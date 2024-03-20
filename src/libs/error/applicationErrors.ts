import {
  type HttpMethods,
  type HttpStatusCode,
  type ResponseData,
  type UrlPaths,
} from '@/types/apiSchemaHelper'

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

/**
 * This error is thrown when fetchApi fails to fetch the API
 */
export class FetchApiError extends Error {
  static {
    this.prototype.name = 'fetchApiError'
  }
  constructor(
    message: string,
    options?: ErrorOptions,
    // FIXME: response をセットできるようにしたいが、現状はうまく読み取れない形になってしまうので修正が必要
    public response?: ResponseData<UrlPaths, HttpMethods, HttpStatusCode>,
  ) {
    super(message, options)
    this.response = response
  }
}
