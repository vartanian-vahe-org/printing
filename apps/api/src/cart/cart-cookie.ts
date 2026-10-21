import type { Request } from 'express';
import { httpOnlyCookie, readCookie } from '../common/cookies.js';
import { config } from '../config.js';

const CART_COOKIE = 'cart';

/** Guest cart token from the request cookie. */
export function cartToken(request: Request): string | undefined {
  return readCookie(request.headers.cookie, CART_COOKIE);
}

export function cartCookie(token: string): string {
  return httpOnlyCookie(CART_COOKIE, token, config.cart.cookieDays * 24 * 60 * 60, config.cookieSecure);
}
