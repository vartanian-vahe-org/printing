import Link from 'next/link';
import { comingSoon, getProducts } from '../../lib/api';
import { isEnabled } from '../../lib/features';
import { BRAND_NAME } from './SiteHeader';
import styles from './site.module.css';

export async function SiteFooter() {
  const year = new Date().getFullYear();
  const products = await getProducts().catch(() => []);
  return (
    <footer className={styles.footer}>
      <div className={styles.footerInner}>
        <div className={styles.footerBrand}>
          <span className={styles.brand}>{BRAND_NAME}</span>
          <p>Custom printing made in our own California facility and shipped across the US.</p>
        </div>
        <div className={styles.footerColumn}>
          <h2>Products</h2>
          {products.map((product) => (
            <Link key={product.code} href={`/${product.code}`}>
              {product.name}
            </Link>
          ))}
          {comingSoon(products).map((name) => (
            <span key={name} className={styles.footerSoon}>
              {name} · coming soon
            </span>
          ))}
        </div>
        <div className={styles.footerColumn}>
          <h2>Ordering</h2>
          <span>Production in 1–5 business days</span>
          <span>Order by 2 PM Pacific, Monday–Friday</span>
          <span>Free proof before we print</span>
          {isEnabled('cart') && <Link href="/orders/find">Track your order</Link>}
        </div>
      </div>
      <div className={styles.footerBottom}>
        © {year} {BRAND_NAME}. All rights reserved.
      </div>
    </footer>
  );
}
