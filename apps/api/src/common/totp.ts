/**
 * Time-based one-time passwords (RFC 6238, the codes of Google Authenticator, 1Password, Authy):
 * HMAC-SHA1, 30-second steps, 6 digits. Small enough to keep in-house and test against the RFC.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export const TOTP_STEP_SECONDS = 30;

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Buffer {
  const clean = text.replace(/[\s=-]/g, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const index = ALPHABET.indexOf(ch);
    if (index < 0) throw new Error('Invalid base32');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** A new random secret (160 bits, as RFC 4226 recommends), base32 for authenticator apps. */
export const generateTotpSecret = () => base32Encode(randomBytes(20));

/** The code for a time step counter. `key` is the raw secret bytes. */
export function hotp(key: Uint8Array, counter: number, digits = 6, algorithm: 'sha1' | 'sha256' | 'sha512' = 'sha1'): string {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac(algorithm, key).update(message).digest();
  const offset = mac[mac.length - 1]! & 0x0f;
  const binary = ((mac[offset]! & 0x7f) << 24) | (mac[offset + 1]! << 16) | (mac[offset + 2]! << 8) | mac[offset + 3]!;
  return String(binary % 10 ** digits).padStart(digits, '0');
}

export const totpCounter = (unixMs: number) => Math.floor(unixMs / 1000 / TOTP_STEP_SECONDS);

/**
 * Checks a code against the current step and one step either side (phone clocks drift).
 * Returns the matching counter (to refuse the same code twice), or null.
 */
export function verifyTotp(secretBase32: string, code: string, unixMs: number): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const key = base32Decode(secretBase32);
  const now = totpCounter(unixMs);
  for (const counter of [now - 1, now, now + 1]) {
    if (timingSafeEqual(Buffer.from(hotp(key, counter)), Buffer.from(code))) return counter;
  }
  return null;
}

/** otpauth:// link the authenticator app reads from the QR code. */
export function otpauthUri(issuer: string, account: string, secretBase32: string): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({ secret: secretBase32, issuer, algorithm: 'SHA1', digits: '6', period: String(TOTP_STEP_SECONDS) });
  return `otpauth://totp/${label}?${params}`;
}
