import {
  type HttpMethods,
  type HttpMethodsFilteredByPath,
  type RequestData,
  type RequestParameters,
  type UrlPaths,
} from './apiSchemaHelper'

export type FetchConfig<Path extends UrlPaths, Method extends HttpMethods> = {
  baseUrl: string
  url: Path
  method: Method & HttpMethodsFilteredByPath<Path>
  params?: RequestParameters<Path, Method>
  data?: RequestData<Path, Method>
}
