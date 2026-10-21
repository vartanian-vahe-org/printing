import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module.js';
import { QuotesController } from './quotes.controller.js';

@Module({
  imports: [CatalogModule],
  controllers: [QuotesController],
})
export class QuotesModule {}
