'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent, type InputHTMLAttributes } from 'react';
import {
  EMPTY_CHECKOUT_FORM,
  rateAddress,
  toShippingAddress,
  validateCheckoutForm,
  type CheckoutField,
  type CheckoutForm,
} from '../../lib/checkout-form';
import { CheckoutError, getCheckoutQuote, orderPath, placeOrder, type CheckoutQuote } from '../../lib/checkout';
import { getMe } from '../../lib/account';
import { formatBusinessDays, formatCents } from '../../lib/format';
import { formatDateRange, formatShopDate } from '../../lib/schedule-text';
import { US_STATE_OPTIONS } from '../../lib/us-states';
import styles from './checkout.module.css';

type LoadState = { kind: 'loading' } | { kind: 'empty' } | { kind: 'error'; message: string } | { kind: 'ready' };

/** Order of fields on the page, to focus the first one with an error. */
const FIELD_ORDER: CheckoutField[] = ['email', 'name', 'company', 'line1', 'line2', 'city', 'state', 'zip', 'phone'];

export function CheckoutView() {
  const router = useRouter();
  const [load, setLoad] = useState<LoadState>({ kind: 'loading' });
  const [quote, setQuote] = useState<CheckoutQuote | null>(null);
  const [form, setForm] = useState<CheckoutForm>(EMPTY_CHECKOUT_FORM);
  const [touched, setTouched] = useState<Partial<Record<CheckoutField, boolean>>>({});
  const [submitted, setSubmitted] = useState(false);
  const [methodCode, setMethodCode] = useState<string | null>(null);
  const [placing, setPlacing] = useState(false);
  const [notice, setNotice] = useState<{ message: string; issues: string[] } | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  // Signed-in customers: email and last shipping address filled in (they can still change them).
  useEffect(() => {
    void getMe()
      .then((customer) => {
        if (!customer) return;
        const last = customer.lastShippingAddress;
        setForm((f) =>
          f.email || f.line1
            ? f
            : {
                ...f,
                email: customer.email,
                ...(last
                  ? { name: last.name, company: last.company ?? '', line1: last.line1, line2: last.line2 ?? '', city: last.city, state: last.state, zip: last.zip, phone: last.phone }
                  : { name: customer.name }),
              },
        );
      })
      .catch(() => undefined);
  }, []);

  const address = rateAddress(form);
  const addressKey = address ? `${address.state}:${address.zip}` : '';
  const errors = validateCheckoutForm(form);
  const showError = (field: CheckoutField) => (submitted || touched[field] ? errors[field] : undefined);

  // Re-price whenever what shipping and tax depend on changes.
  useEffect(() => {
    let cancelled = false;
    getCheckoutQuote({ ...(address ? { address } : {}), ...(methodCode ? { shippingMethodCode: methodCode } : {}) })
      .then((q) => {
        if (cancelled) return;
        setQuote(q);
        setLoad({ kind: 'ready' });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof CheckoutError && err.message === 'Your cart is empty') setLoad({ kind: 'empty' });
        else setLoad({ kind: 'error', message: err instanceof Error ? err.message : 'Could not load checkout' });
      });
    return () => {
      cancelled = true;
    };
  }, [addressKey, methodCode]); // addressKey stands for `address`, which is a new object every render

  function update(field: CheckoutField, value: string) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitted(true);
    setNotice(null);
    const firstError = FIELD_ORDER.find((f) => errors[f]);
    if (firstError) {
      formRef.current?.querySelector<HTMLElement>(`[name="${firstError}"]`)?.focus();
      return;
    }
    if (!quote?.ready || !quote.shippingMethodCode) return;

    setPlacing(true);
    try {
      const order = await placeOrder({
        email: form.email.trim(),
        shippingAddress: toShippingAddress(form),
        shippingMethodCode: quote.shippingMethodCode,
        expectedTotalCents: quote.totals.totalCents,
      });
      if (order.next.type === 'redirect') window.location.assign(order.next.url);
      else router.push(orderPath(order.number, order.accessToken));
    } catch (err) {
      setPlacing(false);
      if (!(err instanceof CheckoutError)) {
        setNotice({ message: 'Something went wrong. Please try again.', issues: [] });
        return;
      }
      setNotice({ message: err.message, issues: err.issues });
      if (err.code === 'total_changed' || err.code === 'shipping_unavailable') {
        // Show the new totals; the customer places the order again after reviewing them.
        const q = await getCheckoutQuote({ ...(address ? { address } : {}) }).catch(() => null);
        if (q) setQuote(q);
        setMethodCode(null);
      }
    }
  }

  if (load.kind === 'loading') return <p className={styles.muted}>Loading checkout…</p>;
  if (load.kind === 'error') return <p className={styles.error}>{load.message}</p>;
  if (load.kind === 'empty' || !quote) {
    return (
      <div className={styles.empty}>
        <h2>Your cart is empty</h2>
        <Link href="/business-cards" className={styles.primary}>
          Design business cards
        </Link>
      </div>
    );
  }

  const field = (name: CheckoutField, label: string, props: InputHTMLAttributes<HTMLInputElement> = {}) => {
    const error = showError(name);
    return (
      <label className={styles.field}>
        <span>{label}</span>
        <input
          name={name}
          value={form[name]}
          onChange={(e) => update(name, e.target.value)}
          onBlur={() => setTouched((t) => ({ ...t, [name]: true }))}
          aria-invalid={error ? true : undefined}
          {...props}
        />
        {error && <small className={styles.fieldError}>{error}</small>}
      </label>
    );
  };

  return (
    <form ref={formRef} className={styles.layout} onSubmit={(e) => void handleSubmit(e)} noValidate>
      <div className={styles.steps}>
        {/* Phones: the summary sits at the end of the page, so show the total up front (U13). */}
        <details className={styles.mobileSummary}>
          <summary>
            <span>
              Order summary · {quote.cart.itemCount} item{quote.cart.itemCount === 1 ? '' : 's'}
            </span>
            <strong>{formatCents(quote.totals.totalCents)}</strong>
          </summary>
          <SummaryLines quote={quote} />
        </details>
        <section className={styles.card}>
          <h2>Contact</h2>
          {field('email', 'Email', { type: 'email', autoComplete: 'email', inputMode: 'email' })}
          <p className={styles.hint}>We send your order confirmation and proof here.</p>
        </section>

        <section className={styles.card}>
          <h2>Shipping address</h2>
          <div className={styles.grid}>
            <div className={styles.full}>{field('name', 'Full name', { autoComplete: 'name' })}</div>
            <div className={styles.full}>{field('company', 'Company (optional)', { autoComplete: 'organization' })}</div>
            <div className={styles.full}>{field('line1', 'Street address', { autoComplete: 'address-line1' })}</div>
            <div className={styles.full}>
              {field('line2', 'Apt, suite, unit (optional)', { autoComplete: 'address-line2' })}
            </div>
            {field('city', 'City', { autoComplete: 'address-level2' })}
            <label className={styles.field}>
              <span>State</span>
              <select
                name="state"
                value={form.state}
                autoComplete="address-level1"
                onChange={(e) => update('state', e.target.value)}
                onBlur={() => setTouched((t) => ({ ...t, state: true }))}
                aria-invalid={showError('state') ? true : undefined}
              >
                <option value="">Select</option>
                {US_STATE_OPTIONS.map((s) => (
                  <option key={s.code} value={s.code}>
                    {s.name}
                  </option>
                ))}
              </select>
              {showError('state') && <small className={styles.fieldError}>{showError('state')}</small>}
            </label>
            {field('zip', 'ZIP code', { autoComplete: 'postal-code', inputMode: 'numeric', maxLength: 10 })}
            {field('phone', 'Phone', { type: 'tel', autoComplete: 'tel' })}
          </div>
          <p className={styles.hint}>We ship to US addresses only. The carrier may call this number about delivery.</p>
        </section>

        <section className={styles.card}>
          <h2>Shipping method</h2>
          {quote.shippingOptions.length === 0 ? (
            <p className={styles.muted}>Enter your state and ZIP code to see shipping options.</p>
          ) : (
            <div className={styles.methods} role="radiogroup" aria-label="Shipping method">
              {quote.shippingOptions.map((option) => (
                <label key={option.code} className={`${styles.method} ${quote.shippingMethodCode === option.code ? styles.methodSelected : ''}`}>
                  <input
                    type="radio"
                    name="shippingMethod"
                    value={option.code}
                    checked={quote.shippingMethodCode === option.code}
                    onChange={() => setMethodCode(option.code)}
                  />
                  <span className={styles.methodText}>
                    <strong>{option.label}</strong>
                    <small>
                      {option.deliveryFrom && option.deliveryTo
                        ? `Arrives ${formatDateRange(option.deliveryFrom, option.deliveryTo)}`
                        : `${formatBusinessDays(option.transitDaysMin, option.transitDaysMax)} in transit after printing`}
                    </small>
                  </span>
                  <span className={option.isFree ? styles.free : undefined}>{option.isFree ? 'FREE' : formatCents(option.priceCents)}</span>
                </label>
              ))}
            </div>
          )}
        </section>

        <section className={styles.card}>
          <h2>Payment</h2>
          <p className={styles.muted}>{quote.payment.note}</p>
        </section>
      </div>

      <aside className={styles.summary} aria-label="Order summary">
        <div className={styles.summaryHead}>
          <h2>Order summary</h2>
          <Link href="/cart">Edit cart</Link>
        </div>
        <SummaryLines quote={quote} />

        {notice && (
          <div className={styles.notice} role="alert">
            <p>{notice.message}</p>
            {notice.issues.length > 0 && (
              <ul>
                {notice.issues.map((issue) => (
                  <li key={issue}>{issue}</li>
                ))}
              </ul>
            )}
          </div>
        )}
        {quote.cart.hasUnavailableItems && (
          <p className={styles.error}>
            Some items are no longer available. <Link href="/cart">Review your cart</Link>
          </p>
        )}

        <button type="submit" className={styles.primary} disabled={placing || quote.cart.hasUnavailableItems}>
          {placing ? 'Placing order…' : 'Place order'}
        </button>
        {!quote.ready && !quote.cart.hasUnavailableItems && (
          <p className={styles.hint}>Enter your shipping address to see the final total.</p>
        )}
        <p className={styles.legal}>By placing your order you agree to our Terms of Use and Privacy Policy.</p>
      </aside>
    </form>
  );
}

/** Items, ship date and totals: in the sidebar, and folded at the top of the page on phones. */
function SummaryLines({ quote }: { quote: CheckoutQuote }) {
  return (
    <>
      <ul className={styles.items}>
        {quote.cart.items.map((item) => (
          <li key={item.id}>
            <div>
              <strong>{item.productName}</strong>
              <small>
                {item.quantity.toLocaleString('en-US')} · {item.summary.find((s) => s.label === 'Paper')?.value ?? ''}
              </small>
            </div>
            <span>{item.totalCents === null ? '—' : formatCents(item.totalCents)}</span>
          </li>
        ))}
      </ul>
      {quote.cart.shipDate && (
        <p className={styles.ships}>
          Ships by <strong>{formatShopDate(quote.cart.shipDate)}</strong> if payment and proof are done today.
        </p>
      )}
      <dl className={styles.totals}>
        <div>
          <dt>Subtotal</dt>
          <dd>{formatCents(quote.totals.subtotalCents)}</dd>
        </div>
        <div>
          <dt>Shipping</dt>
          <dd>{quote.shippingMethodCode ? (quote.totals.shippingCents === 0 ? 'FREE' : formatCents(quote.totals.shippingCents)) : '—'}</dd>
        </div>
        <div>
          <dt>Sales tax{quote.tax && quote.tax.rateBps > 0 ? ` (${(quote.tax.rateBps / 100).toFixed(2)}%)` : ''}</dt>
          <dd>{quote.tax ? formatCents(quote.tax.taxCents) : '—'}</dd>
        </div>
        <div className={styles.total}>
          <dt>Total</dt>
          <dd>{formatCents(quote.totals.totalCents)}</dd>
        </div>
      </dl>
    </>
  );
}
