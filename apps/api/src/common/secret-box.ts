/** Encrypts small secrets kept in the database (AES-256-GCM, key derived from DATA_ENCRYPTION_KEY). */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

const key = (passphrase: string) => createHash('sha256').update(`secret-box:v1:${passphrase}`).digest();

export function sealSecret(plain: string, passphrase: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(passphrase), iv);
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return `v1:${Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64')}`;
}

/** Throws when the value was not sealed with this passphrase (or was changed). */
export function openSecret(sealed: string, passphrase: string): string {
  if (!sealed.startsWith('v1:')) throw new Error('Unknown secret format');
  const raw = Buffer.from(sealed.slice(3), 'base64');
  const decipher = createDecipheriv('aes-256-gcm', key(passphrase), raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
}
