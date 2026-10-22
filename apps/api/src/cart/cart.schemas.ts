import { z } from 'zod';

const code = z.string().min(1).max(100);
const key = z.string().min(1).max(200);

export const configurationSchema = z
  .object({
    selection: z.record(z.string().max(100), z.string().max(100)),
    quantity: z.number().int().positive(),
    customSize: z.object({ widthIn: z.number().positive(), heightIn: z.number().positive() }).strict().optional(),
  })
  .strict();

const templateDesignSchema = z
  .object({
    mode: z.literal('template'),
    templateCode: code,
    /** Text fields only. The logo is uploaded first and referenced by `logoKey`. */
    values: z.record(z.string().regex(/^[a-z][a-z0-9_]*$/), z.string().max(300)).default({}),
    logoKey: key.optional(),
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
        /** Text to print (name, title, phone…), as the customer wants it. */
        content: z.string().trim().min(1, 'Tell us what to put on your card').max(3000),
        /** Look and feel: style, colors, examples. */
        notes: z.string().trim().max(3000).default(''),
        files: z.array(referenceFileSchema).max(5).default([]),
      })
      .strict(),
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
