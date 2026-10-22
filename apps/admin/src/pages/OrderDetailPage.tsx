import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router';
import { api, apiHref, errorText } from '../api';
import { useAuth } from '../auth';
import { OrderActions } from '../components/OrderActions';
import { ShipBy } from '../components/ShipBy';
import { Toast } from '../components/Toast';
import { EMAIL_LABELS, money, PAYMENT_LABELS, PROOF_LABELS, shopDate, shopDateTime, STATUS_LABELS, transitDays, type OrderDetail, type ResendableEmail, type ServiceDesign } from '../orders';
import { uploadPdf } from '../upload';

export function OrderDetailPage() {
  const { number } = useParams();
  const { user } = useAuth();
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [status, setStatus] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [emailKind, setEmailKind] = useState<ResendableEmail>('order-confirmation');

  const load = useCallback(async () => {
    try {
      setOrder(await api<OrderDetail>(`/admin/orders/${number}`));
      setLoadError(null);
    } catch (err) {
      setLoadError(errorText(err));
    }
  }, [number]);

  useEffect(() => {
    void load();
  }, [load]);

  const run = useCallback(
    async (action: () => Promise<unknown>, successText: string) => {
      setBusy(true);
      try {
        await action();
        await load();
        setStatus({ kind: 'ok', text: successText });
        return true;
      } catch (err) {
        setStatus({ kind: 'error', text: errorText(err) });
        await load();
        return false;
      } finally {
        setBusy(false);
      }
    },
    [load],
  );

  if (loadError) return <div className="banner banner-error">{loadError}</div>;
  if (!order) return <p className="page-loading">Loading…</p>;

  const path = `/admin/orders/${order.number}`;
  /** 'staff' (production floor) can print, ship and add notes, but not handle money or cancel. */
  const canManage = user?.role !== 'staff';
  const a = order.shippingAddress;

  return (
    <div className="page page-wide">
      <Link to="/orders" className="back-link">
        ← Orders
      </Link>
      <header className="page-header">
        <div>
          <h1>
            Order #{order.number}
            <span className={`pill pill-status-${order.status}`}>{STATUS_LABELS[order.status] ?? order.status}</span>
            <span className={`pill pill-pay-${order.paymentStatus}`}>{PAYMENT_LABELS[order.paymentStatus] ?? order.paymentStatus}</span>
          </h1>
          <p className="muted">
            Placed {shopDateTime(order.placedAt)} (Pacific) · {money(order.totalCents)}
            {order.shipBy && (
              <>
                {' · '}ship by <ShipBy shipBy={order.shipBy} status={order.status} />
                {order.deliverFrom && order.deliverTo && ` · customer expects ${shopDate(order.deliverFrom)} – ${shopDate(order.deliverTo)}`}
              </>
            )}
          </p>
        </div>
        <a className="btn" href={order.customerUrl} target="_blank" rel="noreferrer">
          Customer page ↗
        </a>
      </header>

      <div className="order-layout">
        <div className="order-main">
          <section className="card card-pad">
            <h2>Items</h2>
            {order.items.map((item, i) => (
              <div key={item.number} className="order-item">
                <div className="order-item-head">
                  <strong>
                    {item.productName} × {item.quantity.toLocaleString('en-US')}
                  </strong>
                  <span>{money(item.totalCents)}</span>
                </div>
                <dl className="spec-list">
                  {item.summary.map((s) => (
                    <div key={s.label}>
                      <dt>{s.label}</dt>
                      <dd>{s.value}</dd>
                    </div>
                  ))}
                </dl>
                <div className="proof-box">
                  <div className="proof-head">
                    <span className={`pill pill-proof-${item.proof.status}`}>Proof: {PROOF_LABELS[item.proof.status]}</span>
                    {item.proof.checkFailed && <span className="pill pill-warn">File check failed</span>}
                    {item.proof.approvedAt && <span className="muted-inline">approved {shopDateTime(item.proof.approvedAt)}</span>}
                    <span className="proof-actions">
                      {order.status === 'placed' && (
                        <button
                          type="button"
                          className="btn btn-small"
                          disabled={busy}
                          onClick={() => void run(() => api(`${path}/items/${item.number}/preflight`, { method: 'POST' }), 'File check started')}
                        >
                          Check again
                        </button>
                      )}
                      {canManage && item.proof.status === 'awaiting_customer' && order.status === 'placed' && (
                        <button
                          type="button"
                          className="btn btn-small"
                          disabled={busy}
                          onClick={() => void run(() => api(`${path}/items/${item.number}/proof/approve`, { method: 'POST' }), 'Proof approved for the customer')}
                        >
                          Approve for customer
                        </button>
                      )}
                    </span>
                  </div>
                  {item.proof.issues.length > 0 && (
                    <ul className="proof-issues">
                      {item.proof.issues.map((issue) => (
                        <li key={issue.id} className={`issue-${issue.level}`}>
                          {issue.level === 'error' ? 'Error' : 'Warning'}: {issue.message}
                        </li>
                      ))}
                    </ul>
                  )}
                  {item.proof.images.length > 0 && (
                    <div className="proof-images">
                      {item.proof.images.map((img) => (
                        <a key={img.page} href={img.url} target="_blank" rel="noreferrer">
                          <img src={img.url} alt={`Proof page ${img.page}`} />
                        </a>
                      ))}
                    </div>
                  )}
                </div>
                <div className="design-box">
                  {item.design.mode === 'template' ? (
                    <>
                      <div className="design-title">Template: {item.templateName}</div>
                      <dl className="spec-list">
                        {Object.entries(item.design.values).map(([key, value]) => (
                          <div key={key}>
                            <dt>{key}</dt>
                            <dd>{value}</dd>
                          </div>
                        ))}
                      </dl>
                      {item.files.length === 0 && <p className="muted">No logo uploaded.</p>}
                    </>
                  ) : item.design.mode === 'service' ? (
                    <ServiceDesignBox
                      design={item.design}
                      packageName={item.designService?.name ?? item.design.tierCode}
                      revisions={item.designService?.revisions ?? null}
                      canDeliver={order.status === 'placed' && item.proof.status !== 'approved' && item.proof.status !== 'pending'}
                      busy={busy}
                      onDeliver={(files) => run(() => api(`${path}/items/${item.number}/design`, { method: 'POST', body: files }), 'Design delivered, file check started')}
                    />
                  ) : (
                    <div className="design-title">Customer artwork (PDF upload)</div>
                  )}
                  <div className="file-links">
                    {(item.design.mode !== 'service' || item.design.artwork) && (
                      <a href={apiHref(`${path}/items/${i + 1}/print-file`)} className="btn btn-small btn-primary">
                        ↓ Print file (PDF)
                      </a>
                    )}
                    {item.files.map((f) => (
                      <a key={f.label} href={f.url} className="btn btn-small">
                        ↓ {f.label}: {f.fileName}
                      </a>
                    ))}
                  </div>
                </div>
              </div>
            ))}
            <dl className="totals">
              <div>
                <dt>Subtotal</dt>
                <dd>{money(order.subtotalCents)}</dd>
              </div>
              <div>
                <dt>Shipping · {order.shippingMethod.label}</dt>
                <dd>{order.shippingCents === 0 ? 'FREE' : money(order.shippingCents)}</dd>
              </div>
              <div>
                <dt>Sales tax{order.tax.rateBps ? ` (${(order.tax.rateBps / 100).toFixed(2)}%)` : ''}</dt>
                <dd>{money(order.taxCents)}</dd>
              </div>
              <div className="totals-grand">
                <dt>Total</dt>
                <dd>{money(order.totalCents)}</dd>
              </div>
            </dl>
          </section>

          <section className="card card-pad">
            <h2>Payments</h2>
            {order.payments.length === 0 ? (
              <p className="muted">None.</p>
            ) : (
              <table className="mini-table">
                <tbody>
                  {order.payments.map((p, i) => (
                    <tr key={i}>
                      <td>{shopDateTime(p.createdAt)}</td>
                      <td>{p.status}</td>
                      <td>{money(p.amountCents)}</td>
                      <td>{p.reference ?? '—'}</td>
                      <td className="muted-inline">{p.recordedBy ?? p.provider}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {order.shipments.length > 0 && (
              <>
                <h2 className="h2-spaced">Shipments</h2>
                <table className="mini-table">
                  <tbody>
                    {order.shipments.map((s) => (
                      <tr key={s.trackingNumber}>
                        <td>{shopDateTime(s.shippedAt)}</td>
                        <td>
                          {s.carrier.toUpperCase()} {s.service}
                        </td>
                        <td>
                          {s.trackingUrl ? (
                            <a href={s.trackingUrl} target="_blank" rel="noreferrer">
                              {s.trackingNumber}
                            </a>
                          ) : (
                            s.trackingNumber
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </section>

          <section className="card card-pad">
            <h2>History</h2>
            <form
              className="note-form"
              onSubmit={(e) => {
                e.preventDefault();
                if (note.trim()) void run(() => api(`${path}/notes`, { method: 'POST', body: { text: note.trim() } }), 'Note added').then((ok) => ok && setNote(''));
              }}
            >
              <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add an internal note" maxLength={2000} aria-label="Internal note" />
              <button type="submit" className="btn btn-small" disabled={busy || !note.trim()}>
                Add note
              </button>
            </form>
            <ul className="history">
              {order.events.map((e, i) => (
                <li key={i} className={`history-${e.type}`}>
                  <span className="history-when">{shopDateTime(e.createdAt)}</span>
                  <span>{e.message}</span>
                  <span className="muted-inline">{e.by}</span>
                </li>
              ))}
              {order.events.length === 0 && <li className="muted-inline">No history yet.</li>}
            </ul>
          </section>
        </div>

        <aside className="order-side">
          <section className="card card-pad">
            <h2>Next step</h2>
            <OrderActions order={order} run={run} busy={busy} canManage={canManage} />
          </section>

          <section className="card card-pad">
            <h2>Customer</h2>
            <p className="plain">
              <a href={`mailto:${order.email}`}>{order.email}</a>
              <br />
              {a.phone}
            </p>
            <h2 className="h2-spaced">Ship to</h2>
            <address className="plain">
              {a.name}
              <br />
              {a.company && (
                <>
                  {a.company}
                  <br />
                </>
              )}
              {a.line1}
              {a.line2 ? `, ${a.line2}` : ''}
              <br />
              {a.city}, {a.state} {a.zip}
            </address>
            <p className="muted">
              {order.shippingMethod.label} · {transitDays(order.shippingMethod.transitDaysMin, order.shippingMethod.transitDaysMax)} in transit
            </p>
          </section>

          <section className="card card-pad">
            <h2>Resend email</h2>
            <div className="note-form">
              <select value={emailKind} onChange={(e) => setEmailKind(e.target.value as ResendableEmail)} aria-label="Email to resend">
                {(Object.keys(EMAIL_LABELS) as ResendableEmail[]).map((kind) => (
                  <option key={kind} value={kind}>
                    {EMAIL_LABELS[kind]}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="btn btn-small"
                disabled={busy}
                onClick={() => void run(() => api(`${path}/emails`, { method: 'POST', body: { kind: emailKind } }), 'Email queued')}
              >
                Send
              </button>
            </div>
            <p className="muted">Goes to {order.email}.</p>
          </section>
        </aside>
      </div>
      <Toast status={status} onClose={() => setStatus(null)} />
    </div>
  );
}

/** "Let us design it": the customer's brief, change requests, and the designer's upload. */
function ServiceDesignBox(props: {
  design: ServiceDesign;
  packageName: string;
  revisions: number | null;
  canDeliver: boolean;
  busy: boolean;
  onDeliver: (files: { front: { key: string; fileName: string }; back?: { key: string; fileName: string } }) => Promise<unknown>;
}) {
  const { design, packageName, revisions, canDeliver, busy, onDeliver } = props;
  const requests = design.changeRequests ?? [];
  const [front, setFront] = useState<File | null>(null);
  const [back, setBack] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!front) return;
    setUploading(true);
    setError(null);
    try {
      const files = { front: await uploadPdf(front), ...(back ? { back: await uploadPdf(back) } : {}) };
      await onDeliver(files);
      setFront(null);
      setBack(null);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setUploading(false);
    }
  }

  return (
    <>
      <div className="design-title">
        Designed for the customer · {packageName} package
        {design.artwork ? ` · draft ${design.artwork.round} sent ${shopDateTime(design.artwork.deliveredAt)}` : ' · no draft sent yet'}
      </div>
      <p className="muted">Text to print</p>
      <div className="brief">{design.brief.content}</div>
      {design.brief.notes && (
        <>
          <p className="muted">Look and feel</p>
          <div className="brief">{design.brief.notes}</div>
        </>
      )}
      {requests.length > 0 && (
        <>
          <p className="muted">
            Change requests ({requests.length}
            {revisions !== null ? ` of ${revisions} included` : ', unlimited'})
          </p>
          {requests.map((r, index) => (
            <div key={index} className="brief">
              <strong>
                {shopDateTime(r.at)} · on draft {r.round}:
              </strong>{' '}
              {r.message}
            </div>
          ))}
        </>
      )}
      {canDeliver && (
        <form className="action-form" onSubmit={(e) => void submit(e)} style={{ margin: '8px 0 12px' }}>
          <strong>{design.artwork ? 'Send a new draft' : 'Send the first draft'}</strong>
          <label className="field">
            <span>Front PDF (or one PDF with front and back)</span>
            <input type="file" accept="application/pdf" onChange={(e) => setFront(e.target.files?.[0] ?? null)} />
          </label>
          <label className="field">
            <span>Back PDF (optional)</span>
            <input type="file" accept="application/pdf" onChange={(e) => setBack(e.target.files?.[0] ?? null)} />
          </label>
          <div className="form-actions" style={{ marginTop: 0 }}>
            <button type="submit" className="btn btn-primary btn-small" disabled={busy || uploading || !front}>
              {uploading ? 'Uploading…' : 'Upload and send proof'}
            </button>
          </div>
          <span className="muted">The file is checked like a customer upload, then the customer is emailed the proof.</span>
          {error && <p className="form-error">{error}</p>}
        </form>
      )}
    </>
  );
}
