import Link from 'next/link';
import { AccountLink } from './AccountLink';
import { getProducts } from '../../lib/api';
import { isEnabled } from '../../lib/features';
import { CartLink } from './CartLink';
import styles from './site.module.css';

/** Brand name is a placeholder until it is decided (docs/open-issues.md U1). */
export const BRAND_NAME = 'Print Studio';

export async function SiteHeader() {
  const products = await getProducts().catch(() => []);
  const only = products.length === 1 ? products[0] : null;
  return (
    <header className={styles.header}>
      <div className={styles.topBar}>Printed in our California shop · Ships nationwide</div>
      <div className={styles.headerInner}>
        <Link href="/" className={styles.brand}>
          {BRAND_NAME}
        </Link>
        <nav aria-label="Main" className={styles.nav}>
          {only ? (
            <Link href={`/${only.code}`} className={styles.navLink}>
              {only.name}
            </Link>
          ) : (
            <div className={styles.navMenu}>
              <Link href="/#products" className={styles.navLink}>
                Products
              </Link>
              <div className={styles.navDropdown}>
                {products.map((product) => (
                  <Link key={product.code} href={`/${product.code}`}>
                    {product.name}
                  </Link>
                ))}
              </div>
            </div>
          )}
          <span className={styles.navSoon} title="Coming soon">
            Flyers
          </span>
          <span className={styles.navSoon} title="Coming soon">
            Stickers &amp; Labels
          </span>
        </nav>
        {isEnabled('account') && <AccountLink />}
        {isEnabled('cart') && <CartLink />}
      </div>
    </header>
  );
}
