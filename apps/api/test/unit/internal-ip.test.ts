import { describe, expect, it } from 'vitest';
import { isInternalIp } from '../../src/redis/public-rate-limit.middleware.js';

describe('isInternalIp', () => {
  it('recognises private, loopback and link-local addresses', () => {
    for (const ip of ['10.0.0.1', '127.0.0.1', '192.168.65.1', '172.18.0.5', '172.31.255.1', '::ffff:172.20.0.3', '::1', 'fd12::1', 'fe80::1', '169.254.1.1']) {
      expect(isInternalIp(ip), ip).toBe(true);
    }
  });

  it('treats public addresses as external', () => {
    for (const ip of ['203.0.113.7', '8.8.8.8', '172.32.0.1', '172.15.0.1', '2001:db8::1', '::ffff:93.184.216.34']) {
      expect(isInternalIp(ip), ip).toBe(false);
    }
  });
});
