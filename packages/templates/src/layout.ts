/**
 * Template layout format, version 1 (stored as JSON in the `templates.layout` column).
 *
 * Positions are fractions (0..1) of a reference box, so one layout adapts to every card size:
 *   - 'bleed': trim + bleed on every side (use for backgrounds and color bands that run off the edge)
 *   - 'trim':  the finished card
 *   - 'safe':  trim minus the safe margin (default for text and images, so nothing gets cut off)
 * Font sizes are in points. Text shrinks to fit `maxWidth` (down to `minSize`).
 */
import { z } from 'zod';

const fraction = z.number().min(0).max(1);
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Expected a #rrggbb color');
const boxRef = z.enum(['bleed', 'trim', 'safe']);
const align = z.enum(['start', 'middle', 'end']);

export const textElementSchema = z.object({
  type: z.literal('text'),
  field: z.string().min(1),
  box: boxRef.default('safe'),
  /** Anchor x (left for start, center for middle, right for end). */
  x: fraction,
  /** Text baseline. */
  y: fraction,
  /** Max width as a fraction of the box width. */
  maxWidth: fraction,
  align: align.default('start'),
  font: z.enum(['sans', 'serif']).default('sans'),
  weight: z.number().int().min(100).max(900).default(400),
  size: z.number().positive(),
  minSize: z.number().positive().default(5),
  color,
  uppercase: z.boolean().default(false),
  /** Extra space between letters, in em. */
  letterSpacing: z.number().min(0).max(1).default(0),
});

export const imageElementSchema = z.object({
  type: z.literal('image'),
  field: z.string().min(1),
  box: boxRef.default('safe'),
  x: fraction,
  y: fraction,
  width: fraction,
  height: fraction,
  /** Horizontal placement of the image inside its frame. */
  align: align.default('middle'),
  /** Color of the "LOGO" placeholder drawn when no image is provided. */
  placeholderColor: color.default('#9a9a9f'),
});

export const rectElementSchema = z.object({
  type: z.literal('rect'),
  box: boxRef.default('bleed'),
  x: fraction,
  y: fraction,
  width: fraction,
  height: fraction,
  fill: color,
  /** Corner radius in points. */
  radius: z.number().min(0).default(0),
});

export const elementSchema = z.discriminatedUnion('type', [textElementSchema, imageElementSchema, rectElementSchema]);

export const faceSchema = z.object({
  background: color,
  elements: z.array(elementSchema),
});

export const fieldSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]*$/),
  label: z.string().min(1),
  type: z.enum(['text', 'image']),
  side: z.enum(['front', 'back', 'both']),
  /** Shown on the card until the customer types something. */
  sample: z.string().optional(),
  maxLength: z.number().int().positive().default(80),
  inputMode: z.enum(['text', 'tel', 'email', 'url']).default('text'),
});

export const templateLayoutSchema = z
  .object({
    version: z.literal(1),
    fields: z.array(fieldSchema).min(1),
    front: faceSchema,
    back: faceSchema,
  })
  .superRefine((layout, ctx) => {
    const keys = new Set(layout.fields.map((f) => f.key));
    for (const side of ['front', 'back'] as const) {
      layout[side].elements.forEach((element, i) => {
        if (element.type !== 'rect' && !keys.has(element.field)) {
          ctx.addIssue({ code: 'custom', path: [side, 'elements', i, 'field'], message: `Unknown field "${element.field}"` });
        }
      });
    }
  });

export type TextElement = z.infer<typeof textElementSchema>;
export type ImageElement = z.infer<typeof imageElementSchema>;
export type RectElement = z.infer<typeof rectElementSchema>;
export type LayoutElement = z.infer<typeof elementSchema>;
export type FaceLayout = z.infer<typeof faceSchema>;
export type TemplateField = z.infer<typeof fieldSchema>;
export type TemplateLayout = z.infer<typeof templateLayoutSchema>;
/** Layout as written in JSON (defaults may be omitted). */
export type TemplateLayoutInput = z.input<typeof templateLayoutSchema>;

export function parseLayout(json: unknown): TemplateLayout {
  return templateLayoutSchema.parse(json);
}

/** Template as served by the API. */
export interface Template {
  code: string;
  name: string;
  description: string | null;
  sortOrder: number;
  supportedSizeCodes: string[];
  layout: TemplateLayout;
}
