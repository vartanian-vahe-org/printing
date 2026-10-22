import { timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

/** Set on requests the storefront's own server makes (page rendering), not on behalf of a visitor. */
export interface TrustedRequest extends Request {
  fromSiteServer?: boolean;
}

function matches(given: string | string[] | undefined, secret: string): boolean {
  if (typeof given !== 'string') return false;
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Sites on Vercel reach the API through their /api proxy (@printing/api-proxy), so the API would see
 * Vercel's address for everyone. With the shared secret, the proxy's X-Client-IP becomes the client
 * address (req.ip) and per-visitor rate limits keep working; a secret without a client IP marks the
 * site's server-side rendering. Without the secret both headers are ignored, so they cannot be faked.
 */
export function trustedProxy(secret: string | undefined) {
  return (request: TrustedRequest, _response: Response, next: NextFunction) => {
    const clientIp = request.headers['x-client-ip'];
    delete request.headers['x-client-ip'];
    if (secret && matches(request.headers['x-proxy-secret'], secret)) {
      // trust proxy is 1 hop: req.ip is the last X-Forwarded-For entry, here the visitor.
      if (typeof clientIp === 'string' && clientIp) request.headers['x-forwarded-for'] = clientIp;
      else request.fromSiteServer = true;
    }
    delete request.headers['x-proxy-secret'];
    next();
  };
}
