/**
 * Same-origin API proxy for the storefront and admin when they run on Vercel and the API on EC2.
 *
 * The browser calls /api/* on the site's own domain, so the API's cookies (cart, customer and admin
 * sessions) are first-party there. Each request is forwarded to API_ORIGIN with API_PROXY_SECRET
 * and the visitor's IP; the API trusts that IP only when the secret matches, so its rate limits
 * still count per visitor rather than per Vercel server.
 *
 * Plain JavaScript with web-standard Request/Response, so a Next.js route handler and a plain
 * Vercel function can both use it without a build step.
 */

/** Request headers worth passing on; everything else (host, forwarded-for…) is dropped. */
const FORWARD_REQUEST = ['accept', 'content-type', 'cookie', 'user-agent', 'x-order-token'];

/** Response headers that must not be copied: the body is re-streamed and already decoded. */
const DROP_RESPONSE = new Set(['connection', 'content-encoding', 'content-length', 'keep-alive', 'set-cookie', 'transfer-encoding']);

/**
 * @param {Request} request incoming request on the site
 * @param {string} path API path without the /api prefix, e.g. "cart/items"
 * @param {{ origin?: string; secret?: string; fetch?: typeof fetch }} [options] defaults: API_ORIGIN, API_PROXY_SECRET
 * @returns {Promise<Response>}
 */
export async function proxyToApi(request, path, options = {}) {
  const origin = options.origin ?? process.env.API_ORIGIN;
  const secret = options.secret ?? process.env.API_PROXY_SECRET;
  if (!origin || !secret) {
    return Response.json({ message: 'The API proxy is not configured (API_ORIGIN, API_PROXY_SECRET).' }, { status: 500 });
  }

  const incoming = new URL(request.url);
  const target = `${origin.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}${incoming.search}`;

  const headers = new Headers();
  for (const name of FORWARD_REQUEST) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  headers.set('x-proxy-secret', secret);
  // Vercel sets these to the visitor's address (and overwrites what the visitor sent).
  const clientIp = request.headers.get('x-real-ip') ?? request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  if (clientIp) headers.set('x-client-ip', clientIp);

  const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
  let upstream;
  try {
    upstream = await (options.fetch ?? fetch)(target, {
      method: request.method,
      headers,
      body: hasBody ? await request.arrayBuffer() : undefined,
      redirect: 'manual',
    });
  } catch {
    return Response.json({ message: 'The shop server is not reachable right now. Please try again in a moment.' }, { status: 502 });
  }

  const out = new Headers();
  upstream.headers.forEach((value, name) => {
    if (!DROP_RESPONSE.has(name)) out.set(name, value);
  });
  // Several cookies can come back at once (sign-in sets the session and the cart).
  for (const cookie of upstream.headers.getSetCookie()) out.append('set-cookie', cookie);
  return new Response(upstream.status === 204 || upstream.status === 304 ? null : upstream.body, { status: upstream.status, headers: out });
}
