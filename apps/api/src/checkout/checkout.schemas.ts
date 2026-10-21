import { isUsPhone, isUsState, isUsZip } from '@printing/pricing';
import { z } from 'zod';

const required = (max: number) => z.string().trim().min(1, 'Required').max(max);
const optional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => v || undefined);

const state = z.string().trim().toUpperCase().refine(isUsState, 'Choose a US state');
const zip = z.string().trim().refine(isUsZip, 'Enter a 5-digit ZIP code');

/** US shipping address, fields as on Vistaprint / UPrinting checkout (phone required for carriers). */
export const shippingAddressSchema = z
  .object({
    name: required(100),
    company: optional(100),
    line1: required(100),
    line2: optional(100),
    city: required(60),
    state,
    zip,
    phone: z.string().trim().refine(isUsPhone, 'Enter a 10-digit US phone number'),
  })
  .strict();

export const checkoutQuoteSchema = z
  .object({
    /** Only what rates and tax depend on; the full address is sent when placing the order. */
    address: z.object({ state, zip }).strict().optional(),
    shippingMethodCode: z.string().max(100).optional(),
  })
  .strict();

export const placeOrderSchema = z
  .object({
    email: z.string().trim().toLowerCase().pipe(z.email('Enter a valid email address').max(254)),
    shippingAddress: shippingAddressSchema,
    shippingMethodCode: z.string().min(1).max(100),
    /** Total the customer saw; the order is refused if the server total differs. */
    expectedTotalCents: z.number().int().min(0),
  })
  .strict();

export type ShippingAddressInput = z.infer<typeof shippingAddressSchema>;
export type CheckoutQuoteInput = z.infer<typeof checkoutQuoteSchema>;
export type PlaceOrderInput = z.infer<typeof placeOrderSchema>;
