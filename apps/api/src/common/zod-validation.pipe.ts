import { BadRequestException, type PipeTransform } from '@nestjs/common';
import type { ZodType } from 'zod';

/** Validates and parses a request body with a zod schema; 400 with field issues on failure. */
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException({
        message: 'Invalid request body',
        issues: result.error.issues.map((issue) => `${issue.path.join('.') || '(body)'}: ${issue.message}`),
      });
    }
    return result.data;
  }
}
