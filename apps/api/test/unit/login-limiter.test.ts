import { describe, expect, it } from 'vitest';
import { LoginLimiter } from '../../src/admin/auth/login-limiter.js';

describe('LoginLimiter', () => {
  it('blocks after 5 failures for the same email, then allows again after 15 minutes', () => {
    const limiter = new LoginLimiter();
    const t0 = 1_000_000;
    for (let i = 0; i < 5; i++) limiter.recordFailure('a@x.com', `10.0.0.${i}`, t0 + i);
    expect(limiter.retryAfterSeconds('a@x.com', '10.0.0.99', t0 + 10)).toBe(900);
    expect(limiter.retryAfterSeconds('a@x.com', '10.0.0.99', t0 + 15 * 60 * 1000 + 1)).toBe(0);
  });

  it('blocks after 5 failures from the same IP across different emails', () => {
    const limiter = new LoginLimiter();
    for (let i = 0; i < 5; i++) limiter.recordFailure(`user${i}@x.com`, '10.0.0.1', i);
    expect(limiter.retryAfterSeconds('someone@x.com', '10.0.0.1', 10)).toBeGreaterThan(0);
    expect(limiter.retryAfterSeconds('someone@x.com', '10.0.0.2', 10)).toBe(0);
  });

  it('clears the email counter after a successful login', () => {
    const limiter = new LoginLimiter();
    for (let i = 0; i < 4; i++) limiter.recordFailure('a@x.com', `10.0.0.${i}`, i);
    limiter.reset('a@x.com');
    limiter.recordFailure('a@x.com', '10.0.0.9', 10);
    expect(limiter.retryAfterSeconds('a@x.com', '10.0.0.8', 11)).toBe(0);
  });
});
