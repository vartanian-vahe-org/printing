import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ResetPassword } from '../../../components/account/TokenPages';
import styles from '../../business-cards/page.module.css';

export const metadata: Metadata = { title: 'Reset your password', robots: { index: false } };

export default function Page() {
  return (
    <main className={styles.main}>
      <div className={styles.intro}>
        <h1 className={styles.title}>Reset your password</h1>
      </div>
      <Suspense>
        <ResetPassword />
      </Suspense>
    </main>
  );
}
