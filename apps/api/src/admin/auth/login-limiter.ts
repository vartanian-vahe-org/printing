import { Injectable } from '@nestjs/common';

const MAX_FAILURES = 5;
const WINDOW_MS = 15 * 60 * 1000;

/**
 * Slows down password guessing: at most 5 failed logins per email and per IP in 15 minutes.
 * In-memory, so it is per API instance (fine for one instance; docs/open-issues.md X5).
 */
@Injectable()
export class LoginLimiter {
  private readonly failures = new Map<string, number[]>();

  private keys(email: string, ip: string) {
    return [`email:${email}`, `ip:${ip}`];
  }

  private recent(key: string, now: number): number[] {
    const list = (this.failures.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
    if (list.length) this.failures.set(key, list);
    else this.failures.delete(key);
    return list;
  }

  /** Seconds until another attempt is allowed, or 0 when allowed now. */
  retryAfterSeconds(email: string, ip: string, now = Date.now()): number {
    let wait = 0;
    for (const key of this.keys(email, ip)) {
      const list = this.recent(key, now);
      if (list.length >= MAX_FAILURES) wait = Math.max(wait, Math.ceil((list[0]! + WINDOW_MS - now) / 1000));
    }
    return wait;
  }

  recordFailure(email: string, ip: string, now = Date.now()) {
    for (const key of this.keys(email, ip)) this.failures.set(key, [...this.recent(key, now), now]);
  }

  reset(email: string) {
    this.failures.delete(`email:${email}`);
  }
}
