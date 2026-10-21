import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { orderItems, orders, storeSettings, type Database } from '@printing/db';
import { InvalidConfigurationError, quote, type Configuration } from '@printing/pricing';
import { layoutFace, type RenderWarning } from '@printing/templates';
import { asc, eq } from 'drizzle-orm';
import { PDFDocument, type PDFImage } from 'pdf-lib';
import sharp from 'sharp';
import { CatalogService } from '../catalog/catalog.service.js';
import { DATABASE } from '../database/database.tokens.js';
import { StorageService } from '../storage/storage.service.js';
import { TemplatesService } from '../templates/templates.service.js';
import { PdfPainter } from './pdf-painter.js';
import { fontkit, fontMeasure } from './print-fonts.js';
import { buildPrintSpec, type PrintSpec } from './print-spec.js';

export type OrderItemRow = typeof orderItems.$inferSelect;

type Design =
  | { mode: 'template'; templateCode: string; values: Record<string, string>; logoKey?: string }
  | { mode: 'upload'; front: { key: string; fileName: string; pageCount: number }; back?: { key: string; fileName: string } };

export interface PrintFile {
  bytes: Uint8Array;
  fileName: string;
  pageCount: number;
  /** Template text that hit the minimum size and may overflow its area. */
  warnings: RenderWarning[];
  item: OrderItemRow;
  spec: PrintSpec;
}

/** Logos are rasterized at this resolution (vector SVG logos included) for print. */
const LOGO_MAX_PX = 2400;

/**
 * Print-ready PDF for one order item (Phase 2 step 7). Template designs are drawn from the layout
 * frozen at checkout with the template fonts embedded; uploaded designs are the customer's own
 * pages, one per printed side. Generated on request; nothing is stored.
 */
@Injectable()
export class PrintFilesService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly storage: StorageService,
    private readonly catalogs: CatalogService,
    private readonly templates: TemplatesService,
  ) {}

  /** `itemNumber` is 1-based, in the order the items were added. */
  async forOrderItem(orderNumber: number, itemNumber: number): Promise<PrintFile> {
    const [order] = await this.db.select({ id: orders.id }).from(orders).where(eq(orders.number, orderNumber)).limit(1);
    if (!order) throw new NotFoundException(`Order #${orderNumber} not found`);
    const items = await this.db.select().from(orderItems).where(eq(orderItems.orderId, order.id)).orderBy(asc(orderItems.createdAt));
    const item = items[itemNumber - 1];
    if (!item) throw new NotFoundException(`Order #${orderNumber} has no item ${itemNumber}`);

    const spec = (item.printSpec as PrintSpec | null) ?? (await this.currentSpec(item));
    const design = item.design as Design;
    const doc = await PDFDocument.create();
    doc.registerFontkit(fontkit);
    const [store] = await this.db.select({ name: storeSettings.storeName }).from(storeSettings).limit(1);
    doc.setTitle(`Order #${orderNumber} – item ${itemNumber} – ${item.productName} × ${item.quantity}`);
    doc.setCreator(store?.name ?? 'Print shop');
    doc.setProducer('Print file generator (Phase 2 step 7)');

    const warnings =
      design.mode === 'template' ? await this.drawTemplate(doc, design, spec) : (await this.copyUploads(doc, design, spec), []);

    return {
      bytes: await doc.save(),
      fileName: `order-${orderNumber}-item-${itemNumber}.pdf`,
      pageCount: doc.getPageCount(),
      warnings,
      item,
      spec,
    };
  }

  /** Orders placed before print specs existed: build one from today's catalog and template. */
  private async currentSpec(item: OrderItemRow): Promise<PrintSpec> {
    try {
      const catalog = await this.catalogs.loadCatalog(item.productCode);
      const q = quote(catalog, item.configuration as unknown as Configuration);
      const design = item.design as Design;
      const template =
        design.mode === 'template'
          ? ((await this.templates.listTemplates(item.productCode)).find((t) => t.code === design.templateCode) ?? null)
          : null;
      return buildPrintSpec(catalog, q, template);
    } catch (err) {
      if (err instanceof InvalidConfigurationError || err instanceof NotFoundException) {
        throw new ConflictException('This item was ordered with options that no longer exist; its print file cannot be rebuilt.');
      }
      throw err;
    }
  }

  private async drawTemplate(doc: PDFDocument, design: Extract<Design, { mode: 'template' }>, spec: PrintSpec): Promise<RenderWarning[]> {
    if (!spec.template) throw new ConflictException('The template of this item is not available anymore.');
    const layout = spec.template.layout;
    const values: Record<string, string> = { ...design.values };
    const images = new Map<string, PDFImage>();

    const logoField = layout.fields.find((f) => f.type === 'image')?.key;
    if (logoField && design.logoKey) {
      images.set(design.logoKey, await doc.embedPng(await this.logoPng(design.logoKey)));
      values[logoField] = design.logoKey;
    }

    const painter = new PdfPainter(doc, images);
    const warnings: RenderWarning[] = [];
    const sides: ('front' | 'back')[] =
      spec.backMode === 'separate' ? ['front', 'back'] : spec.backMode === 'same_as_front' ? ['front', 'front'] : ['front'];
    for (const side of sides) {
      const scene = layoutFace({ layout, side, values, geometry: spec.geometry, area: 'bleed', useSamples: false, measure: fontMeasure });
      warnings.push(...scene.warnings);
      await painter.addPage(scene);
    }
    return warnings.filter((w, i) => warnings.findIndex((o) => o.field === w.field) === i);
  }

  /** PNG of the customer's logo (PNG, JPG, WebP or SVG), with transparency kept. */
  private async logoPng(key: string): Promise<Uint8Array> {
    const source = await this.storage.read(key);
    const png = await sharp(source, { density: 600 })
      .resize({ width: LOGO_MAX_PX, height: LOGO_MAX_PX, fit: 'inside', withoutEnlargement: true })
      .png()
      .toBuffer();
    return new Uint8Array(png);
  }

  /** One page per printed side from the customer's PDF(s). Size checks are preflight's job (step 8). */
  private async copyUploads(doc: PDFDocument, design: Extract<Design, { mode: 'upload' }>, spec: PrintSpec) {
    const front = await PDFDocument.load(await this.storage.read(design.front.key), { ignoreEncryption: true });
    const pages: [PDFDocument, number][] = [[front, 0]];
    if (spec.backMode === 'same_as_front') pages.push([front, 0]);
    if (spec.backMode === 'separate') {
      if (design.back) pages.push([await PDFDocument.load(await this.storage.read(design.back.key), { ignoreEncryption: true }), 0]);
      else if (front.getPageCount() > 1) pages.push([front, 1]);
    }
    for (const [source, index] of pages) {
      const [copy] = await doc.copyPages(source, [index]);
      doc.addPage(copy);
    }
  }
}
