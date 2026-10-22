'use client';

import { resolveSize, sortedTiers, type Catalog } from '@printing/pricing';
import { layoutFace, type Template } from '@printing/templates';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { canvasMeasure } from '../../lib/browser-measure';
import { sceneToPng } from '../../lib/canvas-painter';
import { loadTemplateFonts } from '../../lib/template-fonts';
import { CartError, getCart, removeCartItem, updateCartItem, type Cart, type CartItem } from '../../lib/cart';
import { formatCents } from '../../lib/format';
import { formatShopDate, orderByText } from '../../lib/schedule-text';
import styles from './cart.module.css';

interface ProductData {
  catalog: Catalog;
  templates: Template[];
}

async function loadProduct(code: string): Promise<ProductData | null> {
  const api = process.env.NEXT_PUBLIC_API_URL;
  try {
    const [configurator, templates] = await Promise.all([
      fetch(`${api}/products/${code}/configurator`).then((r) => r.json() as Promise<{ catalog: Catalog }>),
      fetch(`${api}/products/${code}/templates`).then((r) => r.json() as Promise<{ templates: Template[] }>),
    ]);
    return { catalog: configurator.catalog, templates: templates.templates };
  } catch {
    return null;
  }
}

export function CartView() {
  const [cart, setCart] = useState<Cart | null>(null);
  const [products, setProducts] = useState<Record<string, ProductData | null>>({});
  const [error, setError] = useState<string | null>(null);
  const [busyItem, setBusyItem] = useState<string | null>(null);

  useEffect(() => {
    getCart()
      .then(setCart)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Could not load your cart'));
  }, []);

  // Catalog + templates per product in the cart, for quantity choices and design previews.
  useEffect(() => {
    if (!cart) return;
    for (const code of new Set(cart.items.map((i) => i.productCode))) {
      if (code in products) continue;
      setProducts((p) => ({ ...p, [code]: null }));
      void loadProduct(code).then((data) => setProducts((p) => ({ ...p, [code]: data })));
    }
  }, [cart, products]);

  async function run(itemId: string, action: () => Promise<Cart>) {
    setBusyItem(itemId);
    setError(null);
    try {
      setCart(await action());
    } catch (err) {
      setError(err instanceof CartError ? [err.message, ...err.issues].join(' ') : 'Something went wrong');
    } finally {
      setBusyItem(null);
    }
  }

  if (!cart && !error) return <p className={styles.loading}>Loading your cart…</p>;
  if (!cart) return <p className={styles.error}>{error}</p>;

  if (cart.items.length === 0) {
    return (
      <div className={styles.empty}>
        <h2>Your cart is empty</h2>
        <p>Design your business cards and add them here.</p>
        <Link href="/business-cards" className={styles.primary}>
          Design business cards
        </Link>
      </div>
    );
  }

  return (
    <div className={styles.layout}>
      <section className={styles.items} aria-label="Items in your cart">
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
        {cart.items.map((item) => (
          <CartRow
            key={item.id}
            item={item}
            product={products[item.productCode] ?? null}
            busy={busyItem === item.id}
            onQuantity={(quantity) => void run(item.id, () => updateCartItem(item.id, quantity))}
            onRemove={() => void run(item.id, () => removeCartItem(item.id))}
          />
        ))}
      </section>

      <aside className={styles.summary} aria-label="Order summary">
        <h2>Summary</h2>
        <div className={styles.summaryRow}>
          <span>
            Subtotal ({cart.itemCount} item{cart.itemCount === 1 ? '' : 's'})
          </span>
          <strong>{formatCents(cart.subtotalCents)}</strong>
        </div>
        {cart.shipDate && cart.orderBy && cart.timezone && (
          <p className={styles.ships}>
            Ships by <strong>{formatShopDate(cart.shipDate)}</strong> if you order by {orderByText(cart.orderBy, cart.timezone, new Date())}
          </p>
        )}
        <p className={styles.note}>Shipping and sales tax are calculated at checkout.</p>
        {cart.hasUnavailableItems && <p className={styles.warning}>Remove unavailable items to continue.</p>}
        {cart.hasUnavailableItems ? (
          <button type="button" className={styles.primary} disabled>
            Checkout
          </button>
        ) : (
          <Link href="/checkout" className={styles.primary}>
            Checkout
          </Link>
        )}
        <Link href="/business-cards" className={styles.secondary}>
          Continue shopping
        </Link>
      </aside>
    </div>
  );
}

function CartRow({
  item,
  product,
  busy,
  onQuantity,
  onRemove,
}: {
  item: CartItem;
  product: ProductData | null;
  busy: boolean;
  onQuantity: (quantity: number) => void;
  onRemove: () => void;
}) {
  const preview = useDesignPreview(item, product);
  const tiers = product ? sortedTiers(product.catalog).map((t) => t.quantity) : [item.quantity];
  if (!tiers.includes(item.quantity)) tiers.push(item.quantity);

  return (
    <article className={`${styles.row} ${busy ? styles.rowBusy : ''}`}>
      <div className={styles.thumb}>
        {preview ? <img src={preview} alt="Front of your card" /> : <span>{item.design.mode === 'upload' ? 'PDF' : item.design.mode === 'service' ? 'Design' : ''}</span>}
      </div>
      <div className={styles.details}>
        <h3>{item.productName}</h3>
        <p className={styles.designLine}>{designLabel(item, product)}</p>
        <dl className={styles.options}>
          {item.summary.map((s) => (
            <div key={s.label}>
              <dt>{s.label}</dt>
              <dd>{s.value}</dd>
            </div>
          ))}
        </dl>
        {item.shipDate && <p className={styles.itemShips}>Ships by {formatShopDate(item.shipDate)}</p>}
        {item.issues.length > 0 && <p className={styles.warning}>Not available anymore: {item.issues.join(' ')}</p>}
        {item.priceChanged && item.totalCents !== null && (
          <p className={styles.note}>Price updated from {formatCents(item.addedTotalCents)}.</p>
        )}
        <div className={styles.rowActions}>
          <label>
            <span>Quantity</span>
            <select value={item.quantity} disabled={busy || item.totalCents === null} onChange={(e) => onQuantity(Number(e.target.value))}>
              {tiers.map((q) => (
                <option key={q} value={q}>
                  {q.toLocaleString('en-US')}
                </option>
              ))}
            </select>
          </label>
          <Link href={`/business-cards?edit=${item.id}`} className={styles.link}>
            Edit
          </Link>
          <button type="button" className={styles.link} onClick={onRemove} disabled={busy}>
            Remove
          </button>
        </div>
      </div>
      <div className={styles.price}>
        {item.totalCents !== null ? (
          <>
            <strong>{formatCents(item.totalCents)}</strong>
            <span>{formatCents(item.unitPriceCents ?? 0)} each</span>
          </>
        ) : (
          <strong>—</strong>
        )}
      </div>
    </article>
  );
}

function designLabel(item: CartItem, product: ProductData | null): string {
  if (item.design.mode === 'upload') {
    const back = item.design.back ? ` + ${item.design.back.fileName}` : '';
    return `Your design: ${item.design.front.fileName}${back}`;
  }
  if (item.design.mode === 'service') return `Designed for you · ${item.designService?.name ?? item.design.tierCode} package`;
  const { templateCode } = item.design;
  const name = product?.templates.find((t) => t.code === templateCode)?.name ?? templateCode;
  return `${name} template${item.design.values.name ? ` · ${item.design.values.name}` : ''}`;
}

/** Front preview of template designs as a PNG, logo included. */
function useDesignPreview(item: CartItem, product: ProductData | null): string | null {
  const [preview, setPreview] = useState<string | null>(null);
  useEffect(() => {
    if (!product || item.design.mode !== 'template') return;
    const { templateCode, values } = item.design;
    const template = product.templates.find((t) => t.code === templateCode);
    if (!template) return;
    let cancelled = false;
    void (async () => {
      await loadTemplateFonts().catch(() => undefined);
      const size = resolveSize(product.catalog, item.configuration.selection.size ?? '', item.configuration.customSize);
      const geometry = { widthIn: size.widthIn, heightIn: size.heightIn, bleedIn: size.bleedIn, safeIn: size.safeIn };
      // The logo comes from storage through a short-lived link.
      const logoField = template.layout.fields.find((f) => f.type === 'image')?.key;
      const withLogo = logoField && item.previewUrls.logo ? { ...values, [logoField]: item.previewUrls.logo } : values;
      const scene = layoutFace({ layout: template.layout, side: 'front', values: withLogo, geometry, useSamples: false, measure: canvasMeasure });
      const png = await sceneToPng(scene, 1.2);
      if (!cancelled) setPreview(png);
    })().catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [item, product]);
  return preview;
}
