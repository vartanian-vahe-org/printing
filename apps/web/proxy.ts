/**
 * Pages of hidden features (lib/features.ts) go to the home page, and an optional password protects a
 * demo deployment (SITE_BASIC_AUTH="user:password", the role Caddy's basic auth plays on EC2).
 * Neither set (local development, a public launch): every request passes.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { isHiddenPath } from './lib/features';

export function proxy(request: NextRequest) {
  if (isHiddenPath(request.nextUrl.pathname)) return NextResponse.redirect(new URL('/', request.url));
  const expected = process.env.SITE_BASIC_AUTH;
  if (!expected) return NextResponse.next();
  const header = request.headers.get('authorization') ?? '';
  const [scheme, encoded] = header.split(' ');
  if (scheme === 'Basic' && encoded && atob(encoded) === expected) return NextResponse.next();
  return new NextResponse('Password required', { status: 401, headers: { 'WWW-Authenticate': 'Basic realm="Demo", charset="UTF-8"' } });
}

export const config = {
  // Static files and fonts pass: the pages that load them are already protected.
  matcher: ['/((?!_next/static|_next/image|fonts/|favicon.ico).*)'],
};
