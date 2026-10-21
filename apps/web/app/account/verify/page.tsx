import type { Metadata } from 'next';
import { Suspense } from 'react';
import { VerifyEmail } from '../../../components/account/TokenPages';
import styles from '../../business-cards/page.module.css';

export const metadata: Metadata = { title: 'Confirm your email', robots: { index: false } };

export default function Page() {
  return (
    <main className={styles.main}>
      <div className={styles.intro}>
        <h1 className={styles.title}>Confirm your email</h1>
      </div>
      <Suspense>
        <VerifyEmail />
      </Suspense>
    </main>
  );
}
