import { Module } from '@nestjs/common';
import { UploadChecksService } from './upload-checks.service.js';
import { UploadsController } from './uploads.controller.js';

@Module({
  controllers: [UploadsController],
  providers: [UploadChecksService],
})
export class UploadsModule {}
