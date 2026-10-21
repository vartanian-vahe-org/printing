import type { Metadata } from 'next';
import { OrderView } from '../../../components/checkout/OrderView';
import styles from '../../business-cards/page.module.css';

export const metadata: Metadata = {
  title: 'Your order',
  robots: { index: false },
  referrer: 'no-referrer',
};

export default async function OrderPage({ params }: { params: Promise<{ number: string }> }) {
  const { number } = await params;
  return (
    <main className={styles.main}>
      <OrderView number={Number(number)} />
    </main>
  );
}
