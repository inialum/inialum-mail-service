import type {
  HttpMethods,
  HttpStatusCode,
  ResponseData,
  UrlPaths,
} from '@/types/apiSchemaHelper'

/**
 * This error is thrown when SES API returns an error.
 */
export class SESApiError extends Error {
  static {
    // biome-ignore lint/complexity/noThisInStatic: For avoiding TypeError
    this.prototype.name = 'SESApiError'
  }

  // biome-ignore lint/complexity/noUselessConstructor: This constructor is necessary to set the name of the error
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
  }
}

/**
 * This error is thrown when fetchApi fails to fetch the API
 */
export class FetchApiError extends Error {
  static {
    // biome-ignore lint/complexity/noThisInStatic: For avoiding TypeError
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
