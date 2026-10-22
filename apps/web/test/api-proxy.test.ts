import { proxyToApi } from '@printing/api-proxy';
import { describe, expect, it } from 'vitest';

function fakeApi(response: Response) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return response;
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

describe('proxyToApi', () => {
  it('forwards the call with the secret and the visitor IP, and only safe headers', async () => {
    const api = fakeApi(new Response('{"ok":true}', { status: 201, headers: { 'content-type': 'application/json' } }));
    const request = new Request('https://shop.vercel.app/api/cart/items?x=1', {
      method: 'POST',
      headers: { cookie: 'cart=abc', 'content-type': 'application/json', 'x-real-ip': '203.0.113.5', host: 'shop.vercel.app', 'x-forwarded-for': '203.0.113.5, 10.0.0.1' },
      body: '{"a":1}',
    });
    const res = await proxyToApi(request, 'cart/items', { origin: 'https://api.example.com/', secret: 's', fetch: api.fetchImpl });
    expect(res.status).toBe(201);
    expect(api.calls[0]!.url).toBe('https://api.example.com/cart/items?x=1');
    const sent = new Headers(api.calls[0]!.init.headers);
    expect(sent.get('x-proxy-secret')).toBe('s');
    expect(sent.get('x-client-ip')).toBe('203.0.113.5');
    expect(sent.get('cookie')).toBe('cart=abc');
    expect(sent.get('host')).toBeNull();
    expect(sent.get('x-forwarded-for')).toBeNull();
    expect(new TextDecoder().decode(api.calls[0]!.init.body as ArrayBuffer)).toBe('{"a":1}');
  });

  it('returns every cookie the API sets and drops encoding headers', async () => {
    const headers = new Headers({ 'content-encoding': 'gzip', 'content-type': 'application/json' });
    headers.append('set-cookie', 'customer_session=1; Path=/; HttpOnly');
    headers.append('set-cookie', 'cart=2; Path=/; HttpOnly');
    const api = fakeApi(new Response('{}', { status: 200, headers }));
    const res = await proxyToApi(new Request('https://shop/api/account/sign-in', { method: 'POST', body: '{}' }), 'account/sign-in', { origin: 'https://api', secret: 's', fetch: api.fetchImpl });
    expect(res.headers.getSetCookie()).toEqual(['customer_session=1; Path=/; HttpOnly', 'cart=2; Path=/; HttpOnly']);
    expect(res.headers.get('content-encoding')).toBeNull();
  });

  it('answers 502 when the API is unreachable and 500 when not configured', async () => {
    const down = (async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    expect((await proxyToApi(new Request('https://shop/api/health'), 'health', { origin: 'https://api', secret: 's', fetch: down })).status).toBe(502);
    expect((await proxyToApi(new Request('https://shop/api/health'), 'health', { origin: '', secret: '' })).status).toBe(500);
  });
});
