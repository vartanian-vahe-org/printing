'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ACCOUNT_CHANGED_EVENT, getMe, type Customer } from '../../lib/account';
import styles from './site.module.css';

/** "Sign in" or the customer's first name, in the header. */
export function AccountLink() {
  const [customer, setCustomer] = useState<Customer | null | undefined>(undefined);

  useEffect(() => {
    const load = () => void getMe().then(setCustomer, () => setCustomer(null));
    load();
    window.addEventListener(ACCOUNT_CHANGED_EVENT, load);
    return () => window.removeEventListener(ACCOUNT_CHANGED_EVENT, load);
  }, []);

  return (
    <Link href="/account" className={styles.accountLink}>
      {customer === undefined ? 'Account' : customer ? customer.name.split(/\s+/)[0] : 'Sign in'}
    </Link>
  );
}
