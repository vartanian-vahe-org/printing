'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { addToCart, CartError, replaceCartItem, type AddToCartInput } from '../../lib/cart';
import type { PreparedDesign } from '../../lib/cart-design';
import { uploadLogo } from '../../lib/upload';
import styles from './configurator.module.css';

interface Props {
  productCode: string;
  configuration: AddToCartInput['configuration'];
  /** Builds the design payload; receives the uploaded logo key (template mode). */
  prepareDesign: (logoKey: string | null) => PreparedDesign;
  /** data: URL of the customer's logo, uploaded when the item is added. */
  logoDataUrl: string | null;
  /** Editing a cart item: save it back and return to the cart. */
  editingItemId?: string | null;
  /** Called once the item is in the cart (e.g. to drop the saved draft). */
  onAdded?: () => void;
}

type Status = { kind: 'idle' } | { kind: 'busy' } | { kind: 'added' } | { kind: 'error'; message: string };

export function AddToCart({ productCode, configuration, prepareDesign, logoDataUrl, editingItemId, onAdded }: Props) {
  const router = useRouter();
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  /** Uploaded logo keys by data URL, so adding the same design twice does not upload again. */
  const uploadedLogos = useRef(new Map<string, string>());

  async function handleClick() {
    setStatus({ kind: 'busy' });
    try {
      let logoKey: string | null = null;
      if (logoDataUrl) {
        logoKey = uploadedLogos.current.get(logoDataUrl) ?? (await uploadLogo(logoDataUrl)).key;
        uploadedLogos.current.set(logoDataUrl, logoKey);
      }
      const prepared = prepareDesign(logoKey);
      if (!prepared.ok) {
        setStatus({ kind: 'error', message: prepared.message });
        return;
      }
      const input = { productCode, configuration, design: prepared.design };
      if (editingItemId) {
        await replaceCartItem(editingItemId, input);
        router.push('/cart');
        return;
      }
      await addToCart(input);
      onAdded?.();
      setStatus({ kind: 'added' });
    } catch (err) {
      const message =
        err instanceof CartError ? [err.message, ...err.issues].join(' ') : err instanceof Error ? err.message : 'Could not add to cart';
      setStatus({ kind: 'error', message });
    }
  }

  return (
    <div className={styles.addToCart}>
      <button type="button" className={styles.addButton} onClick={() => void handleClick()} disabled={status.kind === 'busy'}>
        {status.kind === 'busy' ? (editingItemId ? 'Saving…' : 'Adding…') : editingItemId ? 'Update item in cart' : 'Add to cart'}
      </button>
      <div aria-live="polite">
        {status.kind === 'added' && (
          <p className={styles.addedNote}>
            Added to your cart. <Link href="/cart">View cart →</Link>
          </p>
        )}
        {status.kind === 'error' && <p className={styles.addError}>{status.message}</p>}
      </div>
    </div>
  );
}
