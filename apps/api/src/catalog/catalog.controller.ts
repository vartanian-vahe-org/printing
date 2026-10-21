import { Controller, Get, Param } from '@nestjs/common';
import { defaultQuantity, resolveSelection } from '@printing/pricing';
import { CatalogService } from './catalog.service.js';

@Controller('products')
export class CatalogController {
  constructor(private readonly catalogs: CatalogService) {}

  /** Everything the storefront needs to render the configurator and price it client-side. */
  @Get(':code/configurator')
  async configurator(@Param('code') code: string) {
    const catalog = await this.catalogs.loadCatalog(code);
    return {
      catalog,
      defaults: {
        selection: resolveSelection(catalog, {}),
        quantity: defaultQuantity(catalog),
      },
    };
  }
}
