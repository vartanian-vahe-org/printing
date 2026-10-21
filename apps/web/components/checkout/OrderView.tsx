'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { CheckoutError, getOrder, type OrderView as Order } from '../../lib/checkout';
import { formatBusinessDays, formatCents } from '../../lib/format';
import { orderTimeline } from '../../lib/order-timeline';
import { getMe } from '../../lib/account';
import { ProofPanel } from './ProofPanel';
import { formatDateRange, formatShopDate } from '../../lib/schedule-text';
import styles from './order.module.css';

const shortDate = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

const STATUS_LABELS: Record<string, string> = {
  placed: 'Order received',
  in_production: 'In production',
  shipped: 'Shipped',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

/** Customer order page. The access token is the URL fragment (/orders/100001#token). */
export function OrderView({ number }: { number: number }) {
  const [order, setOrder] = useState<Order | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [signedIn, setSignedIn] = useState(true);
  useEffect(() => {
    void getMe().then((c) => setSignedIn(Boolean(c)), () => setSignedIn(true));
  }, []);

  const load = useCallback(
    (orderToken: string) =>
      getOrder(number, orderToken)
        .then(setOrder)
        .catch((err: unknown) =>
          setError(err instanceof CheckoutError && err.message === 'Order not found' ? 'We could not find this order. Check that you used the full link.' : 'Could not load your order. Please try again.'),
        ),
    [number],
  );

  useEffect(() => {
    const fromLink = window.location.hash.slice(1);
    if (!fromLink || !Number.isInteger(number)) {
      setError('This order link is incomplete. Use the full link from your confirmation.');
      return;
    }
    setToken(fromLink);
    void load(fromLink);
  }, [number, load]);

  // While a file is being checked, look again every few seconds.
  const checking = order?.items.some((i) => i.proof.status === 'pending' && !i.proof.checkFailed) ?? false;
  useEffect(() => {
    if (!checking || !token) return;
    const timer = setInterval(() => void load(token), 4000);
    return () => clearInterval(timer);
  }, [checking, token, load]);

  if (error) return <p className={styles.error}>{error}</p>;
  if (!order) return <p className={styles.muted}>Loading your order…</p>;

  const address = order.shippingAddress;
  const justPlaced = order.status === 'placed';
  const cancelled = order.status === 'cancelled';
  const awaitingShipment = order.status === 'placed' || order.status === 'in_production';

  return (
    <div className={styles.page}>
      <header className={styles.head}>
        {justPlaced && <p className={styles.eyebrow}>Thank you for your order</p>}
        <h1>Order #{order.number}</h1>
        <p className={styles.muted}>
          {STATUS_LABELS[order.status] ?? order.status} · placed{' '}
          {new Date(order.placedAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })} · we email
          updates to {order.email}
        </p>
      </header>

      {awaitingShipment && order.shipBy && order.deliverFrom && order.deliverTo && (
        <p className={styles.estimate}>
          Estimated delivery <strong>{formatDateRange(order.deliverFrom, order.deliverTo)}</strong> · ships by {formatShopDate(order.shipBy)}
          {order.paymentStatus === 'unpaid' && <small> (if payment and proof are done today)</small>}
        </p>
      )}

      {cancelled ? (
        <div className={styles.notice}>
          <strong>This order was cancelled</strong>
          <p>Questions about it? Reply to your order confirmation email.</p>
        </div>
      ) : (
        <ol className={styles.timeline} aria-label="Order progress">
          {orderTimeline(order).map((step) => (
            <li key={step.key} className={styles[step.state]} aria-current={step.state === 'current' ? 'step' : undefined}>
              <span className={styles.dot} aria-hidden="true" />
              <strong>{step.label}</strong>
              {step.date && <small>{shortDate(step.date)}</small>}
              {step.note && <small>{step.note}</small>}
            </li>
          ))}
        </ol>
      )}

      {order.shipments.length > 0 && (
        <section className={styles.card}>
          <h2>Tracking</h2>
          <ul className={styles.shipments}>
            {order.shipments.map((s) => (
              <li key={s.trackingNumber}>
                <span>
                  {s.carrier.toUpperCase()}
                  {s.service ? ` ${s.service}` : ''} · shipped {shortDate(s.shippedAt)}
                </span>
                {s.trackingUrl ? (
                  <a href={s.trackingUrl} target="_blank" rel="noopener noreferrer">
                    {s.trackingNumber}
                  </a>
                ) : (
                  <span>{s.trackingNumber}</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {order.paymentInstructions && (
        <div className={styles.notice}>
          <strong>Next step: payment</strong>
          <p>{order.paymentInstructions}</p>
        </div>
      )}

      {!cancelled && token && (
        <section className={styles.card}>
          <h2>Your proof</h2>
          {order.items.map((item) => (
            <div key={item.number} className={styles.proofItem}>
              {order.items.length > 1 && (
                <h3>
                  {item.productName} · {item.quantity.toLocaleString('en-US')}
                </h3>
              )}
              <ProofPanel item={item} orderNumber={order.number} token={token} editable={order.status === 'placed'} onChanged={() => void load(token)} />
            </div>
          ))}
        </section>
      )}

      <div className={styles.layout}>
        <section className={styles.card}>
          <h2>Items</h2>
          <ul className={styles.items}>
            {order.items.map((item, i) => (
              <li key={i}>
                <div>
                  <strong>
                    {item.productName} · {item.quantity.toLocaleString('en-US')}
                  </strong>
                  <small>
                    {item.design.mode === 'upload'
                      ? `Your design: ${item.design.front.fileName}${item.design.back ? ` + ${item.design.back.fileName}` : ''}`
                      : `Template design${item.design.values.name ? ` · ${item.design.values.name}` : ''}`}
                  </small>
                  <small>{item.summary.map((s) => s.value).join(' · ')}</small>
                </div>
                <span>{formatCents(item.totalCents)}</span>
              </li>
            ))}
          </ul>
          <dl className={styles.totals}>
            <div>
              <dt>Subtotal</dt>
              <dd>{formatCents(order.subtotalCents)}</dd>
            </div>
            <div>
              <dt>Shipping ({order.shippingMethod.label})</dt>
              <dd>{order.shippingCents === 0 ? 'FREE' : formatCents(order.shippingCents)}</dd>
            </div>
            <div>
              <dt>Sales tax{order.tax.rateBps > 0 ? ` (${(order.tax.rateBps / 100).toFixed(2)}%)` : ''}</dt>
              <dd>{formatCents(order.taxCents)}</dd>
            </div>
            <div className={styles.total}>
              <dt>Total</dt>
              <dd>{formatCents(order.totalCents)}</dd>
            </div>
          </dl>
        </section>

        <aside className={styles.card}>
          <h2>Shipping to</h2>
          <address className={styles.address}>
            {address.name}
            <br />
            {address.company && (
              <>
                {address.company}
                <br />
              </>
            )}
            {address.line1}
            {address.line2 ? `, ${address.line2}` : ''}
            <br />
            {address.city}, {address.state} {address.zip}
            <br />
            {address.phone}
          </address>
          <p className={styles.muted}>
            {order.shippingMethod.label}: {formatBusinessDays(order.shippingMethod.transitDaysMin, order.shippingMethod.transitDaysMax)} in
            transit after printing.
          </p>
          <p className={styles.muted}>
            Keep this page's link private: anyone with it can see your order. Lost it? <Link href="/orders/find">Find your order</Link>.
          </p>
        </aside>
      </div>

      {!signedIn && (
        <p className={styles.muted}>
          Keep all your orders in one place:{' '}
          <Link
            href="/account?mode=register"
            onClick={() => {
              // Prefill without putting the email in the URL (logs, analytics).
              try {
                sessionStorage.setItem('register-email', order.email);
              } catch {
                // Storage blocked: the customer types it.
              }
            }}
          >
            create an account
          </Link>{' '}
          with {order.email}.
        </p>
      )}

      <Link href="/business-cards" className={styles.link}>
        Continue shopping
      </Link>
    </div>
  );
}
