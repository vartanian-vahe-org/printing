import { describe, expect, it } from 'vitest';
import { LoginLimiter, type LimiterStore } from '../../src/admin/auth/login-limiter.js';

/** In-memory stand-in for the few Redis commands the limiter uses, with a movable clock. */
function fakeRedis() {
  let now = 0;
  const data = new Map<string, { value: number; expiresAt: number | null }>();
  const live = (key: string) => {
    const entry = data.get(key);
    if (entry && entry.expiresAt !== null && entry.expiresAt <= now) data.delete(key);
    return data.get(key);
  };
  const store = {
    get: async (key: string) => (live(key) ? String(live(key)!.value) : null),
    ttl: async (key: string) => {
      const entry = live(key);
      return entry?.expiresAt ? Math.ceil((entry.expiresAt - now) / 1000) : -2;
    },
    del: async (key: string) => (data.delete(key) ? 1 : 0),
    multi: () => {
      const ops: (() => void)[] = [];
      const chain = {
        incr: (key: string) => {
          ops.push(() => data.set(key, { value: (live(key)?.value ?? 0) + 1, expiresAt: live(key)?.expiresAt ?? null }));
          return chain;
        },
        expire: (key: string, seconds: number) => {
          ops.push(() => {
            const entry = live(key);
            if (entry && entry.expiresAt === null) entry.expiresAt = now + seconds * 1000;
          });
          return chain;
        },
        exec: async () => (ops.forEach((op) => op()), []),
      };
      return chain;
    },
  };
  return { store: store as unknown as LimiterStore, advance: (ms: number) => (now += ms) };
}

describe('LoginLimiter', () => {
  it('blocks after 5 failures for the same email, then allows again after 15 minutes', async () => {
    const redis = fakeRedis();
    const limiter = new LoginLimiter(redis.store);
    for (let i = 0; i < 5; i++) await limiter.recordFailure('a@x.com', `10.0.0.${i}`);
    expect(await limiter.retryAfterSeconds('A@x.com', '10.0.0.99')).toBe(900);
    redis.advance(15 * 60 * 1000 + 1);
    expect(await limiter.retryAfterSeconds('a@x.com', '10.0.0.99')).toBe(0);
  });

  it('blocks after 5 failures from the same IP across different emails', async () => {
    const limiter = new LoginLimiter(fakeRedis().store);
    for (let i = 0; i < 5; i++) await limiter.recordFailure(`user${i}@x.com`, '10.0.0.1');
    expect(await limiter.retryAfterSeconds('someone@x.com', '10.0.0.1')).toBeGreaterThan(0);
    expect(await limiter.retryAfterSeconds('someone@x.com', '10.0.0.2')).toBe(0);
  });

  it('clears the email counter after a successful login', async () => {
    const limiter = new LoginLimiter(fakeRedis().store);
    for (let i = 0; i < 4; i++) await limiter.recordFailure('a@x.com', `10.0.0.${i}`);
    await limiter.reset('a@x.com');
    await limiter.recordFailure('a@x.com', '10.0.0.9');
    expect(await limiter.retryAfterSeconds('a@x.com', '10.0.0.8')).toBe(0);
  });
});
