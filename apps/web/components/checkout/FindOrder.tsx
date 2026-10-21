'use client';

import { useState, type FormEvent } from 'react';
import { CheckoutError, requestOrderLink } from '../../lib/checkout';
import styles from './order.module.css';

type Status = { kind: 'idle' } | { kind: 'busy' } | { kind: 'sent'; message: string } | { kind: 'error'; message: string };

/** Asks the API to email the private order link again. */
export function FindOrder() {
  const [number, setNumber] = useState('');
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<Status>({ kind: 'idle' });

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const orderNumber = Number(number.replace(/[#\s]/g, ''));
    if (!Number.isInteger(orderNumber) || orderNumber <= 0) {
      setStatus({ kind: 'error', message: 'Enter your order number, for example 100001.' });
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setStatus({ kind: 'error', message: 'Enter the email you used at checkout.' });
      return;
    }
    setStatus({ kind: 'busy' });
    try {
      const { message } = await requestOrderLink(orderNumber, email.trim());
      setStatus({ kind: 'sent', message });
    } catch (err) {
      setStatus({ kind: 'error', message: err instanceof CheckoutError ? err.message : 'Something went wrong. Please try again.' });
    }
  }

  return (
    <form className={`${styles.card} ${styles.findForm}`} onSubmit={(e) => void handleSubmit(e)} noValidate>
      <p className={styles.muted}>Enter your order number and email. We will email you the link to your order.</p>
      <label className={styles.findField}>
        <span>Order number</span>
        <input name="number" value={number} onChange={(e) => setNumber(e.target.value)} inputMode="numeric" placeholder="100001" />
      </label>
      <label className={styles.findField}>
        <span>Email</span>
        <input name="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </label>
      <button type="submit" className={styles.findButton} disabled={status.kind === 'busy'}>
        {status.kind === 'busy' ? 'Sending…' : 'Email me the link'}
      </button>
      <div aria-live="polite">
        {status.kind === 'sent' && <p className={styles.sent}>{status.message}</p>}
        {status.kind === 'error' && <p className={styles.error}>{status.message}</p>}
      </div>
    </form>
  );
}
