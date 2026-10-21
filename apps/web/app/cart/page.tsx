import type { Metadata } from 'next';
import { CartView } from '../../components/cart/CartView';
import styles from '../business-cards/page.module.css';

export const metadata: Metadata = {
  title: 'Your cart',
  robots: { index: false },
};

export default function CartPage() {
  return (
    <main className={styles.main}>
      <div className={styles.intro}>
        <h1 className={styles.title}>Your cart</h1>
      </div>
      <CartView />
    </main>
  );
}
