import { Controller, Get, Param } from '@nestjs/common';
import { TemplatesService } from './templates.service.js';

@Controller('products')
export class TemplatesController {
  constructor(private readonly templates: TemplatesService) {}

  /** Templates with their filter tags, and the filters that apply to them. */
  @Get(':code/templates')
  async list(@Param('code') code: string) {
    const templates = await this.templates.listTemplates(code);
    return { templates, facets: await this.templates.listFacets(code, templates) };
  }

  /** "Let us design it for you" packages and their prices. */
  @Get(':code/design-services')
  async designServices(@Param('code') code: string) {
    return { tiers: await this.templates.listDesignServices(code) };
  }
}
