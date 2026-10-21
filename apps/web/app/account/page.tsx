import type { Metadata } from 'next';
import { Suspense } from 'react';
import { AccountView } from '../../components/account/AccountView';
import styles from '../business-cards/page.module.css';

export const metadata: Metadata = { title: 'Your account', robots: { index: false } };

export default function Page() {
  return (
    <main className={styles.main}>
      <div className={styles.intro}>
        <h1 className={styles.title}>Your account</h1>
      </div>
      <Suspense>
        <AccountView />
      </Suspense>
    </main>
  );
}
