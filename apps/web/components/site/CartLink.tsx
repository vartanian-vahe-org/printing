'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { CART_CHANGED_EVENT, getCart } from '../../lib/cart';
import styles from './site.module.css';

/** Header cart link with an item count badge, refreshed on every cart change. */
export function CartLink() {
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    const load = () =>
      getCart()
        .then((cart) => setCount(cart.itemCount))
        .catch(() => setCount(null));
    void load();
    // Cart calls send the new count; other changes (sign-in, reorder) send none: ask the API.
    const onChange = (event: Event) => {
      const detail = (event as CustomEvent<number | undefined>).detail;
      if (typeof detail === 'number') setCount(detail);
      else void load();
    };
    window.addEventListener(CART_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(CART_CHANGED_EVENT, onChange);
  }, []);

  return (
    <Link href="/cart" className={styles.cartLink} aria-label={count ? `Cart, ${count} items` : 'Cart'}>
      <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
        <path
          d="M3 4h2l2.2 10.2a2 2 0 0 0 2 1.6h7.6a2 2 0 0 0 2-1.5L20.5 8H6.2"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="10" cy="20" r="1.4" fill="currentColor" />
        <circle cx="17" cy="20" r="1.4" fill="currentColor" />
      </svg>
      <span>Cart</span>
      {count ? <span className={styles.cartBadge}>{count}</span> : null}
    </Link>
  );
}
