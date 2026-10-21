import { Controller, Get, Param } from '@nestjs/common';
import { defaultQuantity, resolveSelection } from '@printing/pricing';
import { CatalogService } from './catalog.service.js';
import { ProductionCalendarService } from './production-calendar.service.js';

@Controller('products')
export class CatalogController {
  constructor(
    private readonly catalogs: CatalogService,
    private readonly calendars: ProductionCalendarService,
  ) {}

  /** Everything the storefront needs to render the configurator and price it client-side. */
  @Get(':code/configurator')
  async configurator(@Param('code') code: string) {
    const [catalog, calendar] = await Promise.all([this.catalogs.loadCatalog(code), this.calendars.calendar()]);
    return {
      catalog,
      /** For live "Order by 2 PM PT to ship by …" estimates in the browser. */
      calendar,
      defaults: {
        selection: resolveSelection(catalog, {}),
        quantity: defaultQuantity(catalog),
      },
    };
  }
}
