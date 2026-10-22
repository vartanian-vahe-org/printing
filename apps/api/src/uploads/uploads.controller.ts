import { randomUUID } from 'node:crypto';
import { Body, Controller, Ip, Post } from '@nestjs/common';
import { z } from 'zod';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { config } from '../config.js';
import { RateLimiter } from '../redis/rate-limiter.js';
import { StorageService } from '../storage/storage.service.js';
import { UPLOAD_KINDS } from './upload-kinds.js';

const LOGO_MAX_BYTES = 5 * 1024 * 1024;
const REFERENCE_MAX_BYTES = 25 * 1024 * 1024;

const TYPE_ERRORS = {
  artwork: 'Only PDF files are accepted',
  logo: 'Logos must be PNG, JPG, WebP or SVG',
  reference: 'Files must be PNG, JPG, WebP, SVG or PDF',
} as const;

const presignRequestSchema = z
  .object({
    kind: z.enum(['artwork', 'logo', 'reference']).default('artwork'),
    filename: z.string().trim().min(1).max(255),
    contentType: z.string(),
    sizeBytes: z.number().int().positive(),
  })
  .superRefine((body, ctx) => {
    const kind = UPLOAD_KINDS[body.kind];
    if (!(kind.contentTypes as readonly string[]).includes(body.contentType)) {
      ctx.addIssue({
        code: 'custom',
        path: ['contentType'],
        message: TYPE_ERRORS[body.kind],
      });
    }
    const max = { artwork: config.uploads.maxBytes, logo: LOGO_MAX_BYTES, reference: REFERENCE_MAX_BYTES }[body.kind];
    if (body.sizeBytes > max) {
      ctx.addIssue({ code: 'custom', path: ['sizeBytes'], message: `File must be at most ${max / 1024 / 1024} MB` });
    }
  });

type PresignRequest = z.infer<typeof presignRequestSchema>;

/**
 * Customer uploads go straight from the browser to S3 with a presigned PUT.
 * TODO(docs/open-issues.md X1): rate limit / tie to a session before going public.
 */
@Controller('uploads')
export class UploadsController {
  constructor(
    private readonly storage: StorageService,
    private readonly limiter: RateLimiter,
  ) {}

  /** At most 60 upload links per IP an hour (open issue X1): plenty for designing, not for filling the bucket. */
  @Post('presign')
  async presign(@Body(new ZodValidationPipe(presignRequestSchema)) body: PresignRequest, @Ip() ip: string) {
    await this.limiter.consume(`presign:ip:${ip}`, 60, 3600);
    const kind = UPLOAD_KINDS[body.kind];
    const extension = kind.extension[body.contentType as keyof typeof kind.extension];
    const now = new Date();
    const month = String(now.getUTCMonth() + 1).padStart(2, '0');
    const key = `${kind.prefix}${now.getUTCFullYear()}/${month}/${randomUUID()}.${extension}`;
    const expiresIn = config.uploads.presignExpiresSeconds;

    const uploadUrl = await this.storage.presignPut(key, body.contentType, body.sizeBytes, expiresIn);
    return {
      key,
      filename: body.filename,
      uploadUrl,
      method: 'PUT',
      headers: { 'Content-Type': body.contentType },
      expiresAt: new Date(now.getTime() + expiresIn * 1000).toISOString(),
    };
  }
}
