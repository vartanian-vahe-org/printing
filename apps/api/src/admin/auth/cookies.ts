import { httpOnlyCookie } from '../../common/cookies.js';

export { readCookie } from '../../common/cookies.js';

export const SESSION_COOKIE = 'admin_session';

export function sessionCookie(token: string, maxAgeSeconds: number, secure: boolean): string {
  return httpOnlyCookie(SESSION_COOKIE, token, maxAgeSeconds, secure);
}

export function clearedSessionCookie(secure: boolean): string {
  return sessionCookie('', 0, secure);
}
