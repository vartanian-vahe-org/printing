export interface ProxyOptions {
  /** API base URL; default process.env.API_ORIGIN. */
  origin?: string;
  /** Shared secret; default process.env.API_PROXY_SECRET. */
  secret?: string;
  /** For tests. */
  fetch?: typeof fetch;
}

/** Forwards a site request to the API (see index.js). `path` is without the /api prefix. */
export function proxyToApi(request: Request, path: string, options?: ProxyOptions): Promise<Response>;
