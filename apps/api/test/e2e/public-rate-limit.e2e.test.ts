/** General limit on public reads (X3): 300 a minute per public IP, internal addresses exempt. */
import { describe, expect, it } from 'vitest';
import { base } from './helpers.js';

// 203.0.113.0/24 is reserved for documentation: public-looking, never a real client.
const publicIp = `203.0.113.${1 + Math.floor(Math.random() * 250)}`;
const get = (ip: string) => fetch(`${base}/products/business-cards/templates`, { headers: { 'x-forwarded-for': ip } }).then((r) => r.status);

describe('public rate limit', () => {
  it('answers 429 after 300 requests a minute from one public IP', async () => {
    const statuses: number[] = [];
    for (let batch = 0; batch < 31; batch++) statuses.push(...(await Promise.all(Array.from({ length: 10 }, () => get(publicIp)))));
    expect(statuses.filter((s) => s === 200)).toHaveLength(300);
    expect(statuses.filter((s) => s === 429)).toHaveLength(10);
  });

  it('does not limit internal addresses (the storefront server)', async () => {
    const ip = `10.${Math.floor(Math.random() * 250)}.0.1`;
    const statuses = await Promise.all(Array.from({ length: 20 }, () => get(ip)));
    expect(statuses.every((s) => s === 200)).toBe(true);
  });
});
