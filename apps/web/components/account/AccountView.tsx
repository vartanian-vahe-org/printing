'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  AccountError,
  changePassword,
  forgotPassword,
  getMe,
  getOrders,
  register,
  reorder,
  resendVerification,
  signIn,
  signOut,
  updateName,
  type AccountOrder,
  type Customer,
} from '../../lib/account';
import { formatCents } from '../../lib/format';
import { formatDateRange } from '../../lib/schedule-text';
import styles from './account.module.css';

const STATUS: Record<string, string> = {
  placed: 'Order received',
  in_production: 'Printing',
  shipped: 'Shipped',
  completed: 'Delivered',
  cancelled: 'Cancelled',
};

const message = (err: unknown) => (err instanceof AccountError ? [err.message, ...err.issues].join(' ') : 'Something went wrong. Please try again.');

/** /account: sign in or create an account, or (signed in) the order history. */
export function AccountView() {
  const [customer, setCustomer] = useState<Customer | null | undefined>(undefined);

  useEffect(() => {
    void getMe().then(setCustomer, () => setCustomer(null));
  }, []);

  if (customer === undefined) return <p className={styles.muted}>Loading…</p>;
  if (!customer) return <SignInOrRegister onDone={setCustomer} />;
  return <Dashboard customer={customer} onSignedOut={() => setCustomer(null)} onChanged={setCustomer} />;
}

function SignInOrRegister({ onDone }: { onDone: (c: Customer) => void }) {
  const params = useSearchParams();
  const [mode, setMode] = useState<'sign-in' | 'register' | 'forgot'>(params.get('mode') === 'register' ? 'register' : 'sign-in');
  const [email, setEmail] = useState('');
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem('register-email');
      if (saved) setEmail(saved);
      sessionStorage.removeItem('register-email');
    } catch {
      // Storage blocked: nothing to prefill.
    }
  }, []);
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (mode === 'sign-in') onDone(await signIn(email.trim(), password));
      else if (mode === 'register') onDone(await register({ email: email.trim(), name: name.trim(), password }));
      else setNotice((await forgotPassword(email.trim())).message);
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.authCard}>
      {mode !== 'forgot' && (
        <div className={styles.switch} role="tablist">
          <button type="button" role="tab" aria-selected={mode === 'sign-in'} className={mode === 'sign-in' ? styles.switchActive : ''} onClick={() => setMode('sign-in')}>
            Sign in
          </button>
          <button type="button" role="tab" aria-selected={mode === 'register'} className={mode === 'register' ? styles.switchActive : ''} onClick={() => setMode('register')}>
            Create account
          </button>
        </div>
      )}
      {mode === 'register' && <p className={styles.muted}>See all your orders in one place and reorder in one click. Past orders with your email are added once you confirm it.</p>}
      {mode === 'forgot' && (
        <>
          <h2>Reset your password</h2>
          <p className={styles.muted}>Enter your email and we will send you a link to choose a new password.</p>
        </>
      )}
      <form className={styles.form} onSubmit={(e) => void submit(e)}>
        {mode === 'register' && (
          <label>
            <span>Name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required maxLength={100} />
          </label>
        )}
        <label>
          <span>Email</span>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
        </label>
        {mode !== 'forgot' && (
          <label>
            <span>Password</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
              minLength={mode === 'register' ? 10 : undefined}
              required
            />
            {mode === 'register' && <small>At least 10 characters.</small>}
          </label>
        )}
        <button type="submit" className={styles.primary} disabled={busy}>
          {busy ? 'Please wait…' : mode === 'sign-in' ? 'Sign in' : mode === 'register' ? 'Create account' : 'Email me a link'}
        </button>
        {error && <p className={styles.error}>{error}</p>}
        {notice && <p className={styles.ok}>{notice}</p>}
      </form>
      {mode === 'sign-in' && (
        <button type="button" className={styles.link} onClick={() => setMode('forgot')}>
          Forgot your password?
        </button>
      )}
      {mode === 'forgot' && (
        <button type="button" className={styles.link} onClick={() => setMode('sign-in')}>
          Back to sign in
        </button>
      )}
      <p className={styles.muted}>
        No account needed to order: you can check out as a guest and <Link href="/orders/find">find an order</Link> by email.
      </p>
    </div>
  );
}

function Dashboard({ customer, onSignedOut, onChanged }: { customer: Customer; onSignedOut: () => void; onChanged: (c: Customer) => void }) {
  const router = useRouter();
  const [orders, setOrders] = useState<AccountOrder[] | null>(null);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState<number | null>(null);

  const load = useCallback(() => void getOrders().then(setOrders, (err: unknown) => setNotice({ kind: 'error', text: message(err) })), []);
  useEffect(load, [load]);

  async function again(number: number) {
    setBusy(number);
    setNotice(null);
    try {
      const { skipped } = await reorder(number);
      if (skipped.length === 0) {
        router.push('/cart');
        return;
      }
      setNotice({ kind: 'ok', text: `Added to your cart. Not available any more: ${skipped.join(' ')}` });
    } catch (err) {
      setNotice({ kind: 'error', text: message(err) });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className={styles.dashboard}>
      <div className={styles.profile}>
        <div>
          <strong>{customer.name}</strong>
          <span className={styles.muted}>{customer.email}</span>
        </div>
        <button type="button" className={styles.link} onClick={() => void signOut().then(onSignedOut)}>
          Sign out
        </button>
      </div>

      {!customer.emailVerified && (
        <div className={styles.banner}>
          <p>
            <strong>Confirm your email.</strong> We sent a link to {customer.email}. Orders you placed before with this email show up here after you confirm.
          </p>
          <button
            type="button"
            className={styles.link}
            onClick={() => void resendVerification().then((r) => setNotice({ kind: 'ok', text: r.message }), (err: unknown) => setNotice({ kind: 'error', text: message(err) }))}
          >
            Send the link again
          </button>
        </div>
      )}

      {notice && <p className={notice.kind === 'ok' ? styles.ok : styles.error}>{notice.text}</p>}

      <Profile customer={customer} onChanged={onChanged} />

      <h2>Your orders</h2>
      {!orders ? (
        <p className={styles.muted}>Loading…</p>
      ) : orders.length === 0 ? (
        <p className={styles.muted}>
          No orders yet. <Link href="/business-cards">Design business cards</Link>
        </p>
      ) : (
        <ul className={styles.orders}>
          {orders.map((order) => (
            <li key={order.number}>
              <div className={styles.orderMain}>
                <a href={order.orderPath} className={styles.orderNumber}>
                  Order #{order.number}
                </a>
                <span className={styles.muted}>
                  {new Date(order.placedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} ·{' '}
                  {order.items.map((i) => `${i.productName} × ${i.quantity.toLocaleString('en-US')}`).join(', ')}
                </span>
                <span className={styles.status}>
                  {STATUS[order.status] ?? order.status}
                  {order.status === 'placed' && order.proofStatus === 'awaiting_customer' && ' · proof waiting for you'}
                  {order.status === 'placed' && order.proofStatus === 'needs_new_file' && ' · new file needed'}
                  {order.deliverFrom && order.deliverTo && (order.status === 'placed' || order.status === 'in_production') && ` · arrives ${formatDateRange(order.deliverFrom, order.deliverTo)}`}
                </span>
              </div>
              <div className={styles.orderSide}>
                <strong>{formatCents(order.totalCents)}</strong>
                <button type="button" className={styles.secondary} disabled={busy === order.number} onClick={() => void again(order.number)}>
                  {busy === order.number ? 'Adding…' : 'Order again'}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Profile({ customer, onChanged }: { customer: Customer; onChanged: (c: Customer) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(customer.name);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  async function run(action: () => Promise<void>, text: string) {
    setBusy(true);
    setNotice(null);
    try {
      await action();
      setNotice({ kind: 'ok', text });
    } catch (err) {
      setNotice({ kind: 'error', text: message(err) });
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button type="button" className={styles.link} onClick={() => setOpen(true)}>
        Edit name or password
      </button>
    );
  }
  return (
    <div className={styles.profileForms}>
      <form
        className={styles.form}
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => onChanged(await updateName(name)), 'Name saved.');
        }}
      >
        <label>
          <span>Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" maxLength={100} required />
        </label>
        <button type="submit" className={styles.secondary} disabled={busy || !name.trim() || name.trim() === customer.name}>
          Save name
        </button>
      </form>
      <form
        className={styles.form}
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            await changePassword(current, next);
            setCurrent('');
            setNext('');
          }, 'Password changed. Other devices were signed out.');
        }}
      >
        <label>
          <span>Current password</span>
          <input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
        </label>
        <label>
          <span>New password</span>
          <input type="password" autoComplete="new-password" minLength={10} value={next} onChange={(e) => setNext(e.target.value)} required />
          <small>At least 10 characters.</small>
        </label>
        <button type="submit" className={styles.secondary} disabled={busy || !current || next.length < 10}>
          Change password
        </button>
      </form>
      {notice && <p className={notice.kind === 'ok' ? styles.ok : styles.error}>{notice.text}</p>}
      <p className={styles.muted}>To use a different email, contact us: your orders are tied to it.</p>
    </div>
  );
}
