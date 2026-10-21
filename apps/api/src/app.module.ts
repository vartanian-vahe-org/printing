import { Module } from '@nestjs/common';
import { AdminModule } from './admin/admin.module.js';
import { CatalogModule } from './catalog/catalog.module.js';
import { DatabaseModule } from './database/database.module.js';
import { HealthModule } from './health/health.module.js';
import { QuotesModule } from './quotes/quotes.module.js';
import { StorageModule } from './storage/storage.module.js';
import { TemplatesModule } from './templates/templates.module.js';
import { UploadsModule } from './uploads/uploads.module.js';

@Module({
  imports: [DatabaseModule, StorageModule, HealthModule, CatalogModule, QuotesModule, TemplatesModule, UploadsModule, AdminModule],
})
export class AppModule {}
