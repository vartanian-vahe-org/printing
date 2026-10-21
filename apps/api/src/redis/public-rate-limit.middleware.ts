import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { RateLimiter } from './rate-limiter.js';

const PER_MINUTE = 300;

/** Private, loopback and link-local addresses: the storefront server and other containers. */
export function isInternalIp(ip: string): boolean {
  const v4 = ip.replace(/^::ffff:/, '');
  return (
    /^(10|127)\./.test(v4) ||
    /^192\.168\./.test(v4) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(v4) ||
    /^169\.254\./.test(v4) ||
    ip === '::1' ||
    /^f[cd]/i.test(ip) ||
    /^fe80:/i.test(ip)
  );
}

/**
 * General limit for public read APIs (open issue X3): 300 requests a minute per client IP.
 * Internal addresses are exempt: the storefront renders pages server-side from one container IP.
 * Behind Caddy the client IP comes from X-Forwarded-For (trust proxy 1), so it cannot be spoofed.
 */
@Injectable()
export class PublicRateLimitMiddleware implements NestMiddleware {
  constructor(private readonly limiter: RateLimiter) {}

  async use(request: Request, _response: Response, next: NextFunction) {
    const ip = request.ip ?? '';
    if (!ip || isInternalIp(ip)) return next();
    try {
      await this.limiter.consume(`public:ip:${ip}`, PER_MINUTE, 60);
      next();
    } catch (err) {
      next(err);
    }
  }
}
