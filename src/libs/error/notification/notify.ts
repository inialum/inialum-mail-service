import { FetchApiError } from '@/libs/error/applicationErrors'

import { fetchApi } from '@/utils/fetch'

const ERROR_NOTIFICATION_API_BASE_URL =
  'https://error-notification-api.inialum.org'

/**
 * Notify an error via inialum-error-notification-service.
 */
export const notifyError = async (
  {
    title,
    description,
    environment,
  }: {
    title: string
    description?: string
    environment: 'local' | 'staging' | 'production'
  },
  token: string,
) => {
  try {
    await fetchApi(
      {
        baseUrl: ERROR_NOTIFICATION_API_BASE_URL,
        url: '/api/v1/notify',
        method: 'post',
        data: {
          title,
          description,
          service_name: 'inialum-mail-service',
          environment,
        },
      },
      token,
    )
  } catch (e) {
    if (e instanceof FetchApiError) console.error(e)
    console.error(e)
  }
}
