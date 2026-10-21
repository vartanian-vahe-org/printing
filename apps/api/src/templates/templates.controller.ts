import { Controller, Get, Param } from '@nestjs/common';
import { TemplatesService } from './templates.service.js';

@Controller('products')
export class TemplatesController {
  constructor(private readonly templates: TemplatesService) {}

  @Get(':code/templates')
  async list(@Param('code') code: string) {
    return { templates: await this.templates.listTemplates(code) };
  }
}
