/**
 * Validation for option value attributes, per option group (spec docs/specs/business-card-mvp.md §9).
 * Groups not listed here accept any JSON object.
 */
import { z } from 'zod';

const inches = (max: number) => z.number().min(0).max(max);
const finish = z.enum(['matte', 'gloss', 'uv', 'soft_touch', 'silk', 'none']);

const presetSize = z
  .object({
    trim_w_in: z.number().min(1).max(12),
    trim_h_in: z.number().min(1).max(12),
    bleed_in: inches(0.5),
    safe_in: inches(0.5),
    price_multiplier: z.number().positive().max(20),
  })
  .strict();

const customSize = z
  .object({
    min_in: z.number().min(0.5).max(12),
    max_in: z.number().min(0.5).max(12),
    step_in: z.number().positive().max(2),
    bleed_in: inches(0.5),
    safe_in: inches(0.5),
    fit_box: z.object({ w_in: z.number().positive().max(12), h_in: z.number().positive().max(12) }).strict(),
    fit_multiplier: z.number().positive().max(20),
    area_multiplier: z.number().positive().max(5),
  })
  .strict()
  .refine((a) => a.min_in < a.max_in, { message: 'min_in must be smaller than max_in' });

const schemas: Record<string, (valueCode: string) => z.ZodType> = {
  size: (code) => (code === 'custom' ? customSize : presetSize),
  paper: () => z.object({ thickness_pt: z.number().min(5).max(60), tier: z.string().min(1).max(40) }).strict(),
  coating: () => z.object({ front: finish, back: finish, laminated: z.boolean() }).strict(),
  printed_side: () => z.object({ back: z.enum(['separate', 'blank', 'same_as_front']) }).strict(),
  corners: () => z.object({ radius_in: inches(1) }).strict(),
  turnaround: () => z.object({ business_days: z.number().int().min(1).max(60) }).strict(),
};

export function attributeSchema(groupCode: string, valueCode: string): z.ZodType {
  return schemas[groupCode]?.(valueCode) ?? z.record(z.string(), z.unknown());
}
