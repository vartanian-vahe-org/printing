import type { Metadata } from 'next';
import { FindOrder } from '../../../components/checkout/FindOrder';
import styles from '../../business-cards/page.module.css';

export const metadata: Metadata = { title: 'Find your order' };

export default function FindOrderPage() {
  return (
    <main className={styles.main}>
      <div className={styles.intro}>
        <h1 className={styles.title}>Find your order</h1>
      </div>
      <FindOrder />
    </main>
  );
}
