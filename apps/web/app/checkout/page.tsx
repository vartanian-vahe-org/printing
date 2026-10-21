import type { Metadata } from 'next';
import { CheckoutView } from '../../components/checkout/CheckoutView';
import styles from '../business-cards/page.module.css';

export const metadata: Metadata = {
  title: 'Checkout',
  robots: { index: false },
};

export default function CheckoutPage() {
  return (
    <main className={styles.main}>
      <div className={styles.intro}>
        <h1 className={styles.title}>Checkout</h1>
      </div>
      <CheckoutView />
    </main>
  );
}
