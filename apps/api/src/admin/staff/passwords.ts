import { hash } from '@node-rs/argon2';
import { z } from 'zod';

/** Same minimum as the seeded first admin (packages/db seed-admin). */
export const MIN_PASSWORD_LENGTH = 12;

export const passwordSchema = z
  .string()
  .min(MIN_PASSWORD_LENGTH, `Use at least ${MIN_PASSWORD_LENGTH} characters`)
  .max(200);

export const hashPassword = (password: string) => hash(password);
