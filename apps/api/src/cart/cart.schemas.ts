import { z } from 'zod';

const code = z.string().min(1).max(100);
const key = z.string().min(1).max(200);

export const configurationSchema = z
  .object({
    selection: z.record(z.string().max(100), z.string().max(100)),
    quantity: z.number().int().positive(),
  })
  .strict();

const templateDesignSchema = z
  .object({
    mode: z.literal('template'),
    templateCode: code,
    /** Text fields only. The logo is uploaded first and referenced by `logoKey`. */
    values: z.record(z.string().regex(/^[a-z][a-z0-9_]*$/), z.string().max(300)).default({}),
    logoKey: key.optional(),
    /** The customer reviewed and approved the preview when adding to the cart: no proof after ordering. */
    reviewed: z.literal(true).optional(),
  })
  .strict();

const fileRefSchema = z
  .object({
    key,
    fileName: z.string().trim().min(1).max(255),
    pageCount: z.number().int().min(1).max(10_000),
  })
  .strict();

const uploadDesignSchema = z
  .object({
    mode: z.literal('upload'),
    front: fileRefSchema,
    back: fileRefSchema.optional(),
    /** 'send': a proof to approve after ordering · 'skip': print right away once the file check passes. */
    proof: z.enum(['send', 'skip']).default('send'),
  })
  .strict();

/** Logo, photos or examples the customer gives our designer. */
const referenceFileSchema = z.object({ key, fileName: z.string().trim().min(1).max(255) }).strict();

/** "Let us design it for you": a package and what to put on the card; the designer delivers the PDF later. */
const serviceDesignSchema = z
  .object({
    mode: z.literal('service'),
    tierCode: code,
    brief: z
      .object({
        /** Text to print (name, title, phone…), as the customer wants it; rebuilt from `fields` when they are sent. */
        content: z.string().trim().max(3000).default(''),
        /** The same text field by field, in form order (storefront form). */
        fields: z
          .array(z.object({ key: z.string().regex(/^[a-z0-9_]{1,40}$/), label: z.string().trim().min(1).max(60), value: z.string().trim().min(1).max(1000) }).strict())
          .max(20)
          .optional(),
        /** Look and feel: style, colors, examples. */
        notes: z.string().trim().max(3000).default(''),
        files: z.array(referenceFileSchema).max(5).default([]),
      })
      .strict()
      .transform((brief) => (brief.fields?.length ? { ...brief, content: brief.fields.map((f) => `${f.label}: ${f.value}`).join('\n') } : brief))
      .refine((brief) => brief.content.length > 0, { message: 'Tell us what to put on your card', path: ['content'] }),
  })
  .strict();

export const designSchema = z.discriminatedUnion('mode', [templateDesignSchema, uploadDesignSchema, serviceDesignSchema]);

export const addItemSchema = z
  .object({
    productCode: code,
    configuration: configurationSchema,
    design: designSchema,
  })
  .strict();

export const updateItemSchema = z.object({ quantity: z.number().int().positive() }).strict();

export type Configuration = z.infer<typeof configurationSchema>;
export type Design = z.infer<typeof designSchema>;
export type ServiceDesign = z.infer<typeof serviceDesignSchema>;
export type AddItemInput = z.infer<typeof addItemSchema>;
