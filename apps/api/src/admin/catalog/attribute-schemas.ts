/**
 * Validation for option value attributes, per option group (spec docs/specs/business-card-mvp.md §9).
 * Groups not listed here accept any JSON object.
 */
import { z } from 'zod';

const inches = (max: number) => z.number().min(0).max(max);
const finish = z.enum(['matte', 'gloss', 'uv', 'soft_touch', 'silk', 'none']);

const size = z
  .object({
    trim_w_in: z.number().min(1).max(12),
    trim_h_in: z.number().min(1).max(12),
    bleed_in: inches(0.5),
    safe_in: inches(0.5),
  })
  .strict();

const schemas: Record<string, () => z.ZodType> = {
  size: () => size,
  paper: () => z.object({ thickness_pt: z.number().min(5).max(60), tier: z.string().min(1).max(40) }).strict(),
  coating: () => z.object({ front: finish, back: finish, laminated: z.boolean() }).strict(),
  printed_side: () => z.object({ back: z.enum(['separate', 'blank', 'same_as_front']) }).strict(),
  corners: () => z.object({ radius_in: inches(1) }).strict(),
  // Days and price per quantity live in the turnaround table (turnaround_options).
  turnaround: () => z.object({}).strict(),
};

export function attributeSchema(groupCode: string): z.ZodType {
  return schemas[groupCode]?.() ?? z.record(z.string(), z.unknown());
}
