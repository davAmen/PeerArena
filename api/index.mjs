import { handleRequest } from "../server.mjs";

const ROUTED_PATH_PARAM = "__peerarena_path";

function routedRequest(request) {
  const requestUrl = new URL(request.url ?? "/api/index", "http://peerarena.internal");
  const routedPath = requestUrl.searchParams.get(ROUTED_PATH_PARAM);
  if (!routedPath || (!routedPath.startsWith("/api/") && routedPath !== "/api")) return request;

  requestUrl.searchParams.delete(ROUTED_PATH_PARAM);
  const delegated = Object.create(request);
  delegated.url = `${routedPath}${requestUrl.search}`;
  return delegated;
}

export default async function handler(request, response) {
  return handleRequest(routedRequest(request), response);
}
