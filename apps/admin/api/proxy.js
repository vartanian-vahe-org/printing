/**
 * Vercel function: same-origin proxy from the admin app to the API on EC2 (see @printing/api-proxy).
 * vercel.json rewrites /api/<path> to /api/proxy?path=<path>; the admin calls /api/... (VITE_API_URL=/api)
 * so its session cookie belongs to the admin's own domain.
 */
import { proxyToApi } from '@printing/api-proxy';

async function handle(request) {
  const url = new URL(request.url);
  const path = url.searchParams.get('path') ?? '';
  url.searchParams.delete('path');
  // Same request without the routing parameter, so the API sees only the caller's query string.
  return proxyToApi(new Request(url, request), path);
}

export { handle as DELETE, handle as GET, handle as PATCH, handle as POST, handle as PUT };
