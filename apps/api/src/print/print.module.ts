import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module.js';
import { TemplatesModule } from '../templates/templates.module.js';
import { PrintFilesService } from './print-files.service.js';

@Module({
  imports: [CatalogModule, TemplatesModule],
  providers: [PrintFilesService],
  exports: [PrintFilesService],
})
export class PrintModule {}
