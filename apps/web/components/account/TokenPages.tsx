'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { AccountError, resetPassword, verifyEmail } from '../../lib/account';
import styles from './account.module.css';

/** The one-time token is the URL fragment (#…), so it never reaches a server log. */
const tokenFromLink = () => window.location.hash.slice(1);

export function VerifyEmail() {
  const [state, setState] = useState<{ kind: 'working' } | { kind: 'done' } | { kind: 'error'; text: string }>({ kind: 'working' });
  // The link works once; React may run effects twice in development, so call the API once.
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const token = tokenFromLink();
    if (!token) {
      setState({ kind: 'error', text: 'This link is incomplete. Open the full link from the email.' });
      return;
    }
    verifyEmail(token).then(
      () => setState({ kind: 'done' }),
      (err: unknown) => setState({ kind: 'error', text: err instanceof AccountError ? err.message : 'Could not confirm your email.' }),
    );
  }, []);
  return (
    <div className={styles.authCard}>
      {state.kind === 'working' && <p className={styles.muted}>Confirming your email…</p>}
      {state.kind === 'done' && (
        <>
          <h2>Email confirmed</h2>
          <p className={styles.muted}>Your past orders with this email are now in your account.</p>
          <Link href="/account" className={styles.primary}>
            Go to my account
          </Link>
        </>
      )}
      {state.kind === 'error' && (
        <>
          <p className={styles.error}>{state.text}</p>
          <Link href="/account">Go to my account</Link>
        </>
      )}
    </div>
  );
}

export function ResetPassword() {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await resetPassword(tokenFromLink(), password);
      setDone(true);
    } catch (err) {
      setError(err instanceof AccountError ? [err.message, ...err.issues].join(' ') : 'Could not reset your password.');
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className={styles.authCard}>
        <h2>Password changed</h2>
        <p className={styles.muted}>Sign in with your new password.</p>
        <Link href="/account" className={styles.primary}>
          Sign in
        </Link>
      </div>
    );
  }
  return (
    <form className={`${styles.authCard} ${styles.form}`} onSubmit={(e) => void submit(e)}>
      <h2>Choose a new password</h2>
      <label>
        <span>New password</span>
        <input type="password" autoComplete="new-password" minLength={10} required value={password} onChange={(e) => setPassword(e.target.value)} />
        <small>At least 10 characters.</small>
      </label>
      <button type="submit" className={styles.primary} disabled={busy}>
        {busy ? 'Saving…' : 'Save password'}
      </button>
      {error && <p className={styles.error}>{error}</p>}
    </form>
  );
}
