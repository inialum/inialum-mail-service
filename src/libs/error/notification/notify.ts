import { FetchApiError } from '@/libs/error/applicationErrors'

import { type EnvironmentType } from '@/types/Environment'

import { fetchApi } from '@/utils/fetch'

const ERROR_NOTIFICATION_API_BASE_URL =
  'https://error-notification-api.inialum.org'

/**
 * Notify an error via inialum-error-notification-service.
 *
 * TODO: Make this function out of this project and make it as a package.
 */
export const notifyError = async (
  {
    title,
    description,
    environment,
  }: {
    title: string
    description?: string
    environment: EnvironmentType
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
