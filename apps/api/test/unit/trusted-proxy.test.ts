import { describe, expect, it } from 'vitest';
import { trustedProxy, type TrustedRequest } from '../../src/common/trusted-proxy.js';

function run(headers: Record<string, string>, secret: string | null = 's3cret') {
  const request = { headers: { 'x-forwarded-for': '76.76.21.1', ...headers } } as unknown as TrustedRequest;
  trustedProxy(secret ?? undefined)(request, {} as never, () => undefined);
  return request;
}

describe('trustedProxy', () => {
  it('uses the visitor IP sent by the proxy when the secret matches', () => {
    const request = run({ 'x-proxy-secret': 's3cret', 'x-client-ip': '203.0.113.9' });
    expect(request.headers['x-forwarded-for']).toBe('203.0.113.9');
    expect(request.fromSiteServer).toBeUndefined();
    expect(request.headers['x-proxy-secret']).toBeUndefined();
  });

  it('marks server-side rendering (secret, no visitor IP)', () => {
    expect(run({ 'x-proxy-secret': 's3cret' }).fromSiteServer).toBe(true);
  });

  it('ignores a client IP without the right secret', () => {
    for (const request of [run({ 'x-client-ip': '1.2.3.4' }), run({ 'x-proxy-secret': 'wrong', 'x-client-ip': '1.2.3.4' }), run({ 'x-proxy-secret': 's3cret', 'x-client-ip': '1.2.3.4' }, null)]) {
      expect(request.headers['x-forwarded-for']).toBe('76.76.21.1');
      expect(request.fromSiteServer).toBeUndefined();
      expect(request.headers['x-client-ip']).toBeUndefined();
    }
  });
});
