import type { Get, UnionToIntersection } from 'type-fest'

import type { paths } from '@/types/generated/schema'

const HTTP_STATUS_CODES = [200, 400, 401, 404, 500] as const

export type UrlPaths = keyof paths

export type HttpMethods = keyof UnionToIntersection<paths[UrlPaths]>

export type HttpMethodsFilteredByPath<Path extends UrlPaths> = HttpMethods &
	keyof UnionToIntersection<paths[Path]>

export type HttpStatusCode = (typeof HTTP_STATUS_CODES)[number]

export type RequestParameters<
	Path extends UrlPaths,
	Method extends HttpMethods,
> = Get<paths, `${Path}.${Method}.parameters.query`>

export type RequestData<
	Path extends UrlPaths,
	Method extends HttpMethods,
> = Get<paths, `${Path}.${Method}.requestBody.content.application/json`>

export type ResponseData<
	Path extends UrlPaths,
	Method extends HttpMethods,
	Status extends HttpStatusCode,
> = Get<paths, `${Path}.${Method}.responses.${Status}.content.application/json`>
