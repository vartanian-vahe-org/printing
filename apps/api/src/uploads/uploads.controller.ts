import { randomUUID } from 'node:crypto';
import { Body, Controller, Post } from '@nestjs/common';
import { z } from 'zod';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { config } from '../config.js';
import { StorageService } from '../storage/storage.service.js';

const PDF = 'application/pdf';

const presignRequestSchema = z.object({
  filename: z.string().trim().min(1).max(255),
  contentType: z.literal(PDF, { message: 'Only PDF files are accepted' }),
  sizeBytes: z
    .number()
    .int()
    .positive()
    .max(config.uploads.maxBytes, { message: `File must be at most ${config.uploads.maxBytes / 1024 / 1024} MB` }),
});

type PresignRequest = z.infer<typeof presignRequestSchema>;

/**
 * Artwork uploads go straight from the browser to S3 with a presigned PUT.
 * TODO(docs/open-issues.md X1): rate limit / tie to a session before going public.
 */
@Controller('uploads')
export class UploadsController {
  constructor(private readonly storage: StorageService) {}

  @Post('presign')
  async presign(@Body(new ZodValidationPipe(presignRequestSchema)) body: PresignRequest) {
    const now = new Date();
    const month = String(now.getUTCMonth() + 1).padStart(2, '0');
    const key = `artwork/${now.getUTCFullYear()}/${month}/${randomUUID()}.pdf`;
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
