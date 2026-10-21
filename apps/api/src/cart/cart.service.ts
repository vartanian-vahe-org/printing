import { createHash, randomBytes } from 'node:crypto';
import { BadRequestException, ConflictException, HttpException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { cartItems, carts, type Database } from '@printing/db';
import {
  CUSTOM_SIZE_VALUE,
  InvalidConfigurationError,
  latestDate,
  productionSchedule,
  quote,
  SIZE_GROUP,
  turnaroundDays,
  type Catalog,
  type Quote,
} from '@printing/pricing';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { CatalogService } from '../catalog/catalog.service.js';
import { ProductionCalendarService } from '../catalog/production-calendar.service.js';
import { config } from '../config.js';
import { DATABASE } from '../database/database.tokens.js';
import { StorageService } from '../storage/storage.service.js';
import { TemplatesService } from '../templates/templates.service.js';
import { isUploadKey } from '../uploads/upload-kinds.js';
import { fieldFamilies, unsupportedCharacters } from '@printing/templates';
import { buildPrintSpec, type PrintSpec } from '../print/print-spec.js';
import type { AddItemInput, Configuration, Design } from './cart.schemas.js';

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

export interface CartItemView {
  id: string;
  productCode: string;
  productName: string;
  configuration: Configuration;
  design: Design;
  /** Human-readable option list, e.g. [{ label: 'Paper', value: 'Premium – 16pt Cardstock' }]. */
  summary: { label: string; value: string }[];
  quantity: number;
  /** Current price; null when the configuration is no longer available. */
  totalCents: number | null;
  unitPriceCents: number | null;
  /** Price when the item was added. */
  addedTotalCents: number;
  priceChanged: boolean;
  issues: string[];
  /** Estimated ship day if ordered now (shop calendar date), null when unavailable. */
  shipDate: string | null;
  /** Short-lived links to the customer's own files (logo, PDFs) for previews and editing. */
  previewUrls: { logo?: string; front?: string; back?: string };
}

/** A validated, priced item ready to be stored in a cart. */
export interface PreparedItem {
  productCode: string;
  configuration: Configuration;
  design: Design;
  totalCents: number;
}

export interface CartView {
  items: CartItemView[];
  itemCount: number;
  /** Sum of available items at current prices. */
  subtotalCents: number;
  hasUnavailableItems: boolean;
  /** When the whole order would ship if placed now: the latest item ship date. */
  shipDate: string | null;
  /** Order before this instant (ISO) for that ship date. */
  orderBy: string | null;
  /** Shop time zone, to show the cutoff ("2:00 PM PT"). */
  timezone: string | null;
}

/** A cart item priced and validated again for an order. */
export interface CheckoutItem {
  productCode: string;
  productName: string;
  configuration: Configuration;
  design: Design;
  quote: Quote;
  summary: { label: string; value: string }[];
  /** Production business days of the chosen turnaround. */
  turnaroundDays: number;
  printSpec: PrintSpec;
}

type CartItemRow = typeof cartItems.$inferSelect;

const PREVIEW_LINK_SECONDS = 3600;

const EMPTY_CART: CartView = { items: [], itemCount: 0, subtotalCents: 0, hasUnavailableItems: false, shipDate: null, orderBy: null, timezone: null };

function attributes(catalog: Catalog, group: string, value: string | undefined) {
  return catalog.groups.find((g) => g.code === group)?.values.find((v) => v.code === value)?.attributes ?? {};
}

function sizeLabel(catalog: Catalog, q: Quote): string {
  if (q.size.code === CUSTOM_SIZE_VALUE) return `Custom ${q.size.widthIn}" × ${q.size.heightIn}"`;
  return catalog.groups.find((g) => g.code === SIZE_GROUP)?.values.find((v) => v.code === q.size.code)?.label ?? q.size.code;
}

/** Option list shown in the cart, checkout and orders. */
function itemSummary(catalog: Catalog, q: Quote): { label: string; value: string }[] {
  return [{ label: 'Size', value: sizeLabel(catalog, q) }, ...q.lines.map((l) => ({ label: l.groupLabel, value: l.valueLabel }))];
}

@Injectable()
export class CartService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly catalogs: CatalogService,
    private readonly calendars: ProductionCalendarService,
    private readonly templates: TemplatesService,
    private readonly storage: StorageService,
  ) {}

  // ---------------------------------------------------------------- cart lookup

  /** Cart id for a cookie token, or null. */
  async findCart(token: string | undefined): Promise<string | null> {
    if (!token) return null;
    const [row] = await this.db.select({ id: carts.id }).from(carts).where(eq(carts.tokenHash, hashToken(token))).limit(1);
    return row?.id ?? null;
  }

  /**
   * After a customer signs in: the browser's cart joins the customer's saved cart (S13). Returns a
   * new cookie token when this browser had no cart but the customer has one (the old browser's
   * cookie stops working; the cart follows the latest sign-in).
   */
  async adoptOnSignIn(customerId: string, cookieToken: string | undefined): Promise<string | null> {
    return this.db.transaction(async (tx) => {
      const currentId = cookieToken
        ? ((await tx.select({ id: carts.id }).from(carts).where(eq(carts.tokenHash, hashToken(cookieToken))).limit(1))[0]?.id ?? null)
        : null;
      const [saved] = await tx.select({ id: carts.id }).from(carts).where(eq(carts.customerId, customerId)).orderBy(desc(carts.updatedAt)).limit(1);
      if (currentId) {
        if (saved && saved.id !== currentId) {
          await tx.update(cartItems).set({ cartId: currentId }).where(eq(cartItems.cartId, saved.id));
          await tx.delete(carts).where(eq(carts.id, saved.id));
        }
        await tx.update(carts).set({ customerId, updatedAt: new Date() }).where(eq(carts.id, currentId));
        return null;
      }
      if (!saved) return null;
      const token = randomBytes(32).toString('base64url');
      await tx.update(carts).set({ tokenHash: hashToken(token), updatedAt: new Date() }).where(eq(carts.id, saved.id));
      return token;
    });
  }

  async createCart(customerId?: string): Promise<{ cartId: string; token: string }> {
    const token = randomBytes(32).toString('base64url');
    const [row] = await this.db.insert(carts).values({ tokenHash: hashToken(token), customerId: customerId ?? null }).returning({ id: carts.id });
    return { cartId: row!.id, token };
  }

  // ---------------------------------------------------------------- read

  async view(cartId: string | null): Promise<CartView> {
    if (!cartId) return EMPTY_CART;
    const rows = await this.db.select().from(cartItems).where(eq(cartItems.cartId, cartId)).orderBy(asc(cartItems.createdAt));
    if (rows.length === 0) return EMPTY_CART;

    const now = new Date();
    const calendar = await this.calendars.calendar();
    const catalogCache = new Map<string, Catalog | null>();
    const catalogFor = async (productCode: string) => {
      if (!catalogCache.has(productCode)) {
        catalogCache.set(productCode, await this.catalogs.loadCatalog(productCode).catch(() => null));
      }
      return catalogCache.get(productCode)!;
    };

    const items: CartItemView[] = [];
    for (const row of rows) {
      const configuration = row.configuration as Configuration;
      const design = row.design as Design;
      const catalog = await catalogFor(row.productCode);
      const base = {
        id: row.id,
        productCode: row.productCode,
        configuration,
        design,
        quantity: configuration.quantity,
        addedTotalCents: row.totalCents,
        previewUrls: await this.previewUrls(design),
      };
      if (!catalog) {
        items.push({ ...base, productName: row.productCode, summary: [], totalCents: null, unitPriceCents: null, priceChanged: false, issues: ['This product is no longer available'], shipDate: null });
        continue;
      }
      try {
        const q = quote(catalog, configuration);
        const days = turnaroundDays(catalog, q.selection);
        items.push({
          ...base,
          productName: catalog.product.name,
          summary: itemSummary(catalog, q),
          totalCents: q.totalCents,
          unitPriceCents: q.unitPriceCents,
          priceChanged: q.totalCents !== row.totalCents,
          issues: [],
          shipDate: days ? productionSchedule(now, days, calendar).shipDate : null,
        });
      } catch (err) {
        const issues = err instanceof InvalidConfigurationError ? err.issues : ['This configuration is no longer available'];
        items.push({ ...base, productName: catalog.product.name, summary: [], totalCents: null, unitPriceCents: null, priceChanged: false, issues, shipDate: null });
      }
    }

    return {
      items,
      itemCount: items.length,
      subtotalCents: items.reduce((sum, item) => sum + (item.totalCents ?? 0), 0),
      hasUnavailableItems: items.some((item) => item.totalCents === null),
      shipDate: latestDate(items.flatMap((item) => (item.shipDate ? [item.shipDate] : []))),
      // Every schedule starts on the same day, so any item's cutoff is the order's cutoff.
      orderBy: productionSchedule(now, 1, calendar).orderBy,
      timezone: calendar.timezone,
    };
  }

  /**
   * Prices and validates cart rows again for an order (current prices, template still offered,
   * files still in storage). 409 listing every item that cannot be ordered as is.
   */
  async checkoutItems(rows: CartItemRow[]): Promise<CheckoutItem[]> {
    const items: CheckoutItem[] = [];
    const issues: string[] = [];
    for (const [index, row] of rows.entries()) {
      const label = `Item ${index + 1}`;
      try {
        const catalog = await this.catalogs.loadCatalog(row.productCode);
        const configuration = row.configuration as Configuration;
        const q = this.priced(catalog, configuration);
        const design = await this.validateDesign(catalog, q, row.design as Design);
        const days = turnaroundDays(catalog, q.selection);
        if (!days) throw new ConflictException('The turnaround of this item is not available');
        const template =
          design.mode === 'template'
            ? ((await this.templates.listTemplates(catalog.product.code)).find((t) => t.code === design.templateCode) ?? null)
            : null;
        items.push({
          productCode: row.productCode,
          productName: catalog.product.name,
          configuration,
          design,
          quote: q,
          summary: itemSummary(catalog, q),
          turnaroundDays: days,
          printSpec: buildPrintSpec(catalog, q, template),
        });
      } catch (err) {
        if (!(err instanceof HttpException)) throw err;
        const body = err.getResponse() as { message?: string; issues?: string[] } | string;
        const details = typeof body === 'string' ? [body] : (body.issues ?? [body.message ?? 'Not available']);
        issues.push(...details.map((d) => `${label}: ${d}`));
      }
    }
    if (issues.length > 0) {
      throw new ConflictException({ message: 'Some items in your cart cannot be ordered. Please review your cart.', code: 'cart_invalid', issues });
    }
    return items;
  }

  // ---------------------------------------------------------------- write

  /** Prices and validates an item without touching any cart, so a rejected add creates nothing. */
  async prepareItem(input: AddItemInput): Promise<PreparedItem> {
    const catalog = await this.catalogs.loadCatalog(input.productCode);
    const q = this.priced(catalog, input.configuration);
    // Store what was actually priced (e.g. custom dimensions that match a preset become the preset).
    const configuration: Configuration = {
      selection: q.selection,
      quantity: q.quantity,
      ...(q.size.code === CUSTOM_SIZE_VALUE ? { customSize: input.configuration.customSize } : {}),
    };
    const design = await this.validateDesign(catalog, q, input.design);
    return { productCode: input.productCode, configuration, design, totalCents: q.totalCents };
  }

  async addItem(cartId: string, item: PreparedItem): Promise<void> {
    const [{ count } = { count: 0 }] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(cartItems)
      .where(eq(cartItems.cartId, cartId));
    if (count >= config.cart.maxItems) throw new BadRequestException(`A cart can hold up to ${config.cart.maxItems} items`);

    await this.db.insert(cartItems).values({ cartId, ...item });
    await this.touch(cartId);
  }

  async updateQuantity(cartId: string, itemId: string, quantity: number): Promise<void> {
    const row = await this.item(cartId, itemId);
    const configuration = { ...(row.configuration as Configuration), quantity };
    const q = this.priced(await this.catalogs.loadCatalog(row.productCode), configuration);
    await this.db
      .update(cartItems)
      .set({ configuration, totalCents: q.totalCents })
      .where(eq(cartItems.id, itemId));
    await this.touch(cartId);
  }

  /** Replaces an item's options and design (the customer edited it); checked like a new add. */
  async replaceItem(cartId: string, itemId: string, item: PreparedItem): Promise<void> {
    await this.item(cartId, itemId);
    await this.db.update(cartItems).set({ ...item, updatedAt: new Date() }).where(eq(cartItems.id, itemId));
    await this.touch(cartId);
  }

  async removeItem(cartId: string, itemId: string): Promise<void> {
    await this.item(cartId, itemId);
    await this.db.delete(cartItems).where(eq(cartItems.id, itemId));
    await this.touch(cartId);
  }

  // ---------------------------------------------------------------- helpers

  private async previewUrls(design: Design): Promise<CartItemView['previewUrls']> {
    const link = (key: string, name: string) => this.storage.presignGet(key, name, PREVIEW_LINK_SECONDS, 'inline');
    if (design.mode === 'template') return design.logoKey ? { logo: await link(design.logoKey, 'logo') } : {};
    return {
      front: await link(design.front.key, design.front.fileName),
      ...(design.back ? { back: await link(design.back.key, design.back.fileName) } : {}),
    };
  }

  private async item(cartId: string, itemId: string) {
    const [row] = await this.db
      .select()
      .from(cartItems)
      .where(and(eq(cartItems.id, itemId), eq(cartItems.cartId, cartId)))
      .limit(1);
    if (!row) throw new NotFoundException('Cart item not found');
    return row;
  }

  private async touch(cartId: string) {
    await this.db.update(carts).set({ updatedAt: new Date() }).where(eq(carts.id, cartId));
  }

  private priced(catalog: Catalog, configuration: Configuration): Quote {
    try {
      return quote(catalog, configuration);
    } catch (err) {
      if (err instanceof InvalidConfigurationError) {
        throw new BadRequestException({ message: 'Invalid configuration', issues: err.issues });
      }
      throw err;
    }
  }

  private async assertUploaded(kind: 'artwork' | 'logo', key: string, label: string) {
    if (!isUploadKey(kind, key) || !(await this.storage.describe(key))) {
      throw new BadRequestException(`${label} was not found. Please upload it again.`);
    }
  }

  /** Checks the design against the template and uploaded files; returns it normalized. */
  private async validateDesign(catalog: Catalog, q: Quote, design: Design): Promise<Design> {
    const backMode = String(attributes(catalog, 'printed_side', q.selection.printed_side).back ?? 'separate');

    if (design.mode === 'template') {
      const template = (await this.templates.listTemplates(catalog.product.code)).find((t) => t.code === design.templateCode);
      if (!template) throw new BadRequestException('This template is not available');
      if (!template.supportedSizeCodes.includes(q.size.code)) {
        throw new BadRequestException(`The ${template.name} template is not available for this size`);
      }
      const textFields = new Map(template.layout.fields.filter((f) => f.type === 'text').map((f) => [f.key, f]));
      const values: Record<string, string> = {};
      for (const [fieldKey, value] of Object.entries(design.values)) {
        const field = textFields.get(fieldKey);
        if (!field) continue; // Fields of another template the customer tried before; not printed.
        if (value.length > field.maxLength) throw new BadRequestException(`${field.label} is too long`);
        // The template fonts cannot draw everything (emoji, most non-Latin scripts): refuse what would print as boxes.
        const missing = [...new Set(fieldFamilies(template.layout, fieldKey).flatMap((family) => unsupportedCharacters(value, family)))];
        if (missing.length) throw new BadRequestException(`${field.label}: these characters cannot be printed: ${missing.join(' ')}`);
        if (value.trim()) values[fieldKey] = value.trim();
      }
      if (design.logoKey) await this.assertUploaded('logo', design.logoKey, 'The logo');
      return { mode: 'template', templateCode: template.code, values, ...(design.logoKey ? { logoKey: design.logoKey } : {}) };
    }

    await this.assertUploaded('artwork', design.front.key, 'The front PDF');
    if (design.back) await this.assertUploaded('artwork', design.back.key, 'The back PDF');
    if (backMode === 'separate' && !design.back && design.front.pageCount < 2) {
      throw new BadRequestException('Add your back design: upload a back file or a 2-page PDF.');
    }
    // A back file is not used when the back is blank or repeats the front.
    return backMode === 'separate' ? design : { mode: 'upload', front: design.front };
  }
}
