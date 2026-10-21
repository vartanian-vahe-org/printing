/** Minimal cookie helpers (no dependency) for the httpOnly cookies the API sets. */

export function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return undefined;
}

/**
 * httpOnly cookie, SameSite=Lax: sent on same-site requests (storefront, admin and API share a
 * site), never on cross-site POSTs. `secure` must be true outside local development.
 */
export function httpOnlyCookie(name: string, value: string, maxAgeSeconds: number, secure: boolean): string {
  const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAgeSeconds}`];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}
