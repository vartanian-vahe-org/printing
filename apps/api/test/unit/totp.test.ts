import { describe, expect, it } from 'vitest';
import { openSecret, sealSecret } from '../../src/common/secret-box.js';
import { base32Decode, base32Encode, generateTotpSecret, hotp, otpauthUri, totpCounter, verifyTotp } from '../../src/common/totp.js';

describe('TOTP (RFC 6238 test vectors, SHA-1)', () => {
  const key = Buffer.from('12345678901234567890');
  // RFC 6238 appendix B: 8-digit codes for these Unix times.
  const vectors: [number, string][] = [
    [59, '94287082'],
    [1111111109, '07081804'],
    [1111111111, '14050471'],
    [1234567890, '89005924'],
    [2000000000, '69279037'],
    [20000000000, '65353130'],
  ];
  for (const [seconds, code] of vectors) {
    it(`matches the RFC code at t=${seconds}`, () => {
      expect(hotp(key, totpCounter(seconds * 1000), 8)).toBe(code);
    });
  }

  it('round-trips base32', () => {
    expect(base32Encode(key)).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
    expect(base32Decode('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ').equals(key)).toBe(true);
    expect(base32Decode(generateTotpSecret())).toHaveLength(20);
  });

  it('accepts the current code and one step of clock drift, nothing older', () => {
    const secret = base32Encode(key);
    const now = 1_700_000_000_000;
    const code = hotp(key, totpCounter(now));
    expect(verifyTotp(secret, code, now)).toBe(totpCounter(now));
    expect(verifyTotp(secret, code, now + 30_000)).toBe(totpCounter(now));
    expect(verifyTotp(secret, code, now + 90_000)).toBeNull();
    expect(verifyTotp(secret, '12345', now)).toBeNull();
  });

  it('builds the otpauth link for the QR code', () => {
    expect(otpauthUri('Print Studio', 'a@b.co', 'ABC')).toBe(
      'otpauth://totp/Print%20Studio%3Aa%40b.co?secret=ABC&issuer=Print+Studio&algorithm=SHA1&digits=6&period=30',
    );
  });
});

describe('secret box', () => {
  it('encrypts, decrypts, and refuses the wrong key or a changed value', () => {
    const sealed = sealSecret('JBSWY3DPEHPK3PXP', 'key-one');
    expect(sealed).not.toContain('JBSWY3DPEHPK3PXP');
    expect(openSecret(sealed, 'key-one')).toBe('JBSWY3DPEHPK3PXP');
    expect(() => openSecret(sealed, 'key-two')).toThrow();
    expect(() => openSecret(sealed.slice(0, -4) + 'AAAA', 'key-one')).toThrow();
  });
});
