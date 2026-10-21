import { Module } from '@nestjs/common';
import { CatalogController } from './catalog.controller.js';
import { CatalogService } from './catalog.service.js';
import { ProductionCalendarService } from './production-calendar.service.js';

@Module({
  controllers: [CatalogController],
  providers: [CatalogService, ProductionCalendarService],
  exports: [CatalogService, ProductionCalendarService],
})
export class CatalogModule {}
