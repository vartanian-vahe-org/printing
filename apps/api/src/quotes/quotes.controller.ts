import { BadRequestException, Body, Controller, HttpCode, Post } from '@nestjs/common';
import { InvalidConfigurationError, quote } from '@printing/pricing';
import { z } from 'zod';
import { CatalogService } from '../catalog/catalog.service.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';

const quoteRequestSchema = z.object({
  productCode: z.string().min(1).max(100),
  selection: z.record(z.string().max(100), z.string().max(100)),
  quantity: z.number().int().positive(),
  customSize: z
    .object({
      widthIn: z.number().positive(),
      heightIn: z.number().positive(),
    })
    .optional(),
});

type QuoteRequest = z.infer<typeof quoteRequestSchema>;

@Controller('quotes')
export class QuotesController {
  constructor(private readonly catalogs: CatalogService) {}

  /** Official price: re-validates the configuration against the current catalog in the DB. */
  @Post()
  @HttpCode(200)
  async create(@Body(new ZodValidationPipe(quoteRequestSchema)) body: QuoteRequest) {
    const catalog = await this.catalogs.loadCatalog(body.productCode);
    try {
      return quote(catalog, { selection: body.selection, quantity: body.quantity, customSize: body.customSize });
    } catch (err) {
      if (err instanceof InvalidConfigurationError) {
        throw new BadRequestException({ message: 'Invalid configuration', issues: err.issues });
      }
      throw err;
    }
  }
}
