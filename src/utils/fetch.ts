import type { Fetcher, RequestInit } from '@cloudflare/workers-types'

import { FetchApiError } from '@/libs/error/applicationErrors'

import type {
  HttpMethods,
  ResponseData,
  UrlPaths,
} from '@/types/apiSchemaHelper'
import type { FetchConfig } from '@/types/fetch'

/**
 * Fetches INIALUM microservices API.
 * @param config
 * @param token
 * @param service If you set this arg, the fetchApi function accesses the API via the Service Bindings.
 */
export const fetchApi = async <
  Path extends UrlPaths,
  Method extends HttpMethods,
>(
  config: FetchConfig<Path, Method>,
  token: string,
  service?: Fetcher,
) => {
  try {
    const url =
      config.baseUrl +
      (config.params
        ? `${config.url}?${new URLSearchParams(config.params).toString()}`
        : config.url)
    const options = {
      method: config.method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(config.data),
    } satisfies RequestInit

    const res = service
      ? await service.fetch(url, options)
      : await fetch(url, options)
    if (!res.ok) {
      switch (res.status) {
        case 400:
          throw new FetchApiError(
            'Bad Request',
            undefined,
            (await res.json()) as ResponseData<Path, Method, 400>,
          )
        case 401:
          throw new FetchApiError('Unauthorized')
        case 404:
          throw new FetchApiError('Not Found')
        case 500:
          throw new FetchApiError(
            'Internal Server Error',
            undefined,
            (await res.json()) as ResponseData<Path, Method, 500>,
          )
        default:
          throw new FetchApiError('Unknown Error')
      }
    }
    return res.json() as ResponseData<Path, Method, 200>
  } catch (error) {
    if (error instanceof FetchApiError) {
      throw error
    }
    throw new FetchApiError(
      error instanceof Error
        ? error.message
        : 'fetchApi function fails to fetch the API',
      {
        cause: error,
      },
    )
  }
}
