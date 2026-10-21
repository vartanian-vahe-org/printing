import Link from 'next/link';
import { AccountLink } from './AccountLink';
import { CartLink } from './CartLink';
import styles from './site.module.css';

/** Brand name is a placeholder until it is decided (docs/open-issues.md U1). */
export const BRAND_NAME = 'Print Studio';

export function SiteHeader() {
  return (
    <header className={styles.header}>
      <div className={styles.topBar}>Printed in our California shop · Ships nationwide</div>
      <div className={styles.headerInner}>
        <Link href="/" className={styles.brand}>
          {BRAND_NAME}
        </Link>
        <nav aria-label="Main" className={styles.nav}>
          <Link href="/business-cards" className={styles.navLink}>
            Business Cards
          </Link>
          <span className={styles.navSoon} title="Coming soon">
            Flyers
          </span>
          <span className={styles.navSoon} title="Coming soon">
            Stickers &amp; Labels
          </span>
        </nav>
        <AccountLink />
        <CartLink />
        <Link href="/business-cards" className={styles.headerCta}>
          Start designing
        </Link>
      </div>
    </header>
  );
}
