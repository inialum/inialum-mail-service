import type {
  HttpMethods,
  HttpMethodsFilteredByPath,
  RequestData,
  RequestParameters,
  UrlPaths,
} from './apiSchemaHelper'

export type FetchConfig<Path extends UrlPaths, Method extends HttpMethods> = {
  baseUrl: string
  url: Path
  method: Method & HttpMethodsFilteredByPath<Path>
  params?: RequestParameters<Path, Method>
  data?: RequestData<Path, Method>
}
