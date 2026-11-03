import { randomUUID } from 'node:crypto';
import { BadRequestException, Body, Controller, Get, HttpCode, Ip, NotFoundException, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { z } from 'zod';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { config } from '../config.js';
import { RateLimiter } from '../redis/rate-limiter.js';
import { StorageService } from '../storage/storage.service.js';
import { UploadChecksService } from './upload-checks.service.js';
import { isUploadKey, UPLOAD_KINDS } from './upload-kinds.js';

const LOGO_MAX_BYTES = 5 * 1024 * 1024;
const REFERENCE_MAX_BYTES = 25 * 1024 * 1024;

const TYPE_ERRORS = {
  artwork: 'Upload a PDF, AI, TIFF, JPG or PSD file',
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

const inches = (max: number) => z.number().positive().max(max);
const checkRequestSchema = z.object({
  key: z.string().max(200),
  geometry: z.object({ widthIn: inches(48), heightIn: inches(48), bleedIn: z.number().min(0).max(1), safeIn: z.number().min(0).max(1) }).strict(),
  side: z.enum(['front', 'back']),
  maxPages: z.union([z.literal(1), z.literal(2)]),
  /** Pages the customer picked from a multi-page file, in print order (front, then back), 1-based. */
  pages: z.array(z.number().int().min(1).max(1000)).min(1).max(2).optional(),
});

type CheckRequest = z.infer<typeof checkRequestSchema>;

/**
 * Customer uploads go straight from the browser to S3 with a presigned PUT.
 * TODO(docs/open-issues.md X1): rate limit / tie to a session before going public.
 */
@Controller('uploads')
export class UploadsController {
  constructor(
    private readonly storage: StorageService,
    private readonly limiter: RateLimiter,
    private readonly checks: UploadChecksService,
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

  /**
   * Starts the file check of an uploaded artwork file for a card size. The worker makes the print PDF
   * (stored under a new artwork key) and checks it; poll GET /uploads/checks/:id for the result.
   */
  @Post('checks')
  @HttpCode(202)
  async startCheck(@Body(new ZodValidationPipe(checkRequestSchema)) body: CheckRequest, @Ip() ip: string) {
    await this.limiter.consume(`upload-check:ip:${ip}`, 60, 3600);
    if (!isUploadKey('artwork', body.key) || !(await this.storage.describe(body.key))) {
      throw new BadRequestException('The file was not found. Please upload it again.');
    }
    const now = new Date();
    const outputKey = `${UPLOAD_KINDS.artwork.prefix}${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${randomUUID()}.pdf`;
    const id = await this.checks.start({ sourceKey: body.key, outputKey, geometry: body.geometry, side: body.side, maxPages: body.maxPages, pages: body.pages });
    return { id };
  }

  /** 'checking' until the worker is done; then the issues and the print PDF's key to put in the cart. */
  @Get('checks/:id')
  async check(@Param('id', new ParseUUIDPipe()) id: string) {
    const view = await this.checks.view(id);
    if (!view) throw new NotFoundException('Unknown file check');
    // The print PDF for the storefront's preview (the original may be a TIFF or PSD it cannot show).
    if (view.status === 'done' && view.outputKey) return { ...view, url: await this.storage.presignGet(view.outputKey, 'card.pdf', 15 * 60, 'inline') };
    return view;
  }
}
