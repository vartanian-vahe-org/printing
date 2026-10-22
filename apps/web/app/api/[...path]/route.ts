/**
 * Same-origin proxy to the API (storefront on Vercel, API on EC2): the browser calls /api/* here,
 * so cart and sign-in cookies belong to this site. Used when NEXT_PUBLIC_API_URL is "/api".
 */
import { proxyToApi } from '@printing/api-proxy';

export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ path: string[] }> };

async function handle(request: Request, { params }: Context): Promise<Response> {
  const { path } = await params;
  return proxyToApi(request, path.map(encodeURIComponent).join('/'));
}

export { handle as DELETE, handle as GET, handle as PATCH, handle as POST, handle as PUT };
