import { useState, type FormEvent, type ReactNode } from 'react';
import { api } from '../api';
import { money, type OrderAction, type OrderDetail } from '../orders';

interface Props {
  order: OrderDetail;
  /** Runs an API call with toast + reload; resolves true on success. */
  run: (action: () => Promise<unknown>, successText: string) => Promise<boolean>;
  busy: boolean;
  /** False for the 'staff' role: payments, cancel and refunds are hidden (the API refuses them too). */
  canManage: boolean;
}

/** Actions only owners and admins can take. */
const MANAGER_ACTIONS: OrderAction[] = ['record_payment', 'cancel', 'record_refund'];

const CARRIERS = [
  { code: 'ups', label: 'UPS' },
  { code: 'usps', label: 'USPS' },
  { code: 'fedex', label: 'FedEx' },
  { code: 'other', label: 'Other' },
];

/** The next steps staff can take on this order (only those the workflow allows). */
export function OrderActions({ order, run, busy, canManage }: Props) {
  const path = `/admin/orders/${order.number}`;
  const visible = order.allowedActions.filter((a) => canManage || !MANAGER_ACTIONS.includes(a));
  const can = (action: OrderAction) => visible.includes(action);

  if (visible.length === 0) {
    return (
      <p className="muted">
        {order.allowedActions.length === 0 ? 'Nothing left to do on this order.' : 'Waiting for an admin (payment, cancellation or refund).'}
      </p>
    );
  }

  return (
    <div className="actions-stack">
      {can('record_payment') && (
        <PaymentForm
          busy={busy}
          totalCents={order.totalCents}
          onSubmit={(reference, notify) => run(() => api(`${path}/payments`, { method: 'POST', body: { reference, notify } }), 'Payment recorded')}
        />
      )}
      {can('start_production') && (
        <ActionCard title="Ready to print" hint="Payment is in. Move the order to production when printing starts.">
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void run(() => api(`${path}/production`, { method: 'POST' }), 'Moved to production')}>
            Start printing
          </button>
        </ActionCard>
      )}
      {can('add_shipment') && (
        <ShipmentForm
          busy={busy}
          again={order.status === 'shipped'}
          onSubmit={(body) => run(() => api(`${path}/shipments`, { method: 'POST', body }), 'Tracking added')}
        />
      )}
      {can('mark_delivered') && (
        <ActionCard title="Delivered?" hint="Mark the order delivered once the carrier confirms it.">
          <button type="button" className="btn" disabled={busy} onClick={() => void run(() => api(`${path}/delivered`, { method: 'POST' }), 'Marked delivered')}>
            Mark delivered
          </button>
        </ActionCard>
      )}
      {can('record_refund') && (
        <ReferenceForm
          title="Refund due"
          hint={`This cancelled order was paid. Refund ${money(order.totalCents)} to the customer, then record it here.`}
          placeholder="e.g. Zelle refund 10/22"
          button="Record refund"
          busy={busy}
          onSubmit={(reference) => run(() => api(`${path}/refunds`, { method: 'POST', body: { reference } }), 'Refund recorded')}
        />
      )}
      {can('cancel') && <CancelForm busy={busy} paid={order.paymentStatus === 'paid'} onSubmit={(body) => run(() => api(`${path}/cancel`, { method: 'POST', body }), 'Order cancelled')} />}
    </div>
  );
}

function ActionCard({ title, hint, children, tone }: { title: string; hint?: string; children: ReactNode; tone?: 'danger' }) {
  return (
    <section className={`action-card ${tone === 'danger' ? 'action-danger' : ''}`}>
      <h3>{title}</h3>
      {hint && <p className="muted">{hint}</p>}
      {children}
    </section>
  );
}

function PaymentForm({ busy, totalCents, onSubmit }: { busy: boolean; totalCents: number; onSubmit: (reference: string, notify: boolean) => Promise<boolean> }) {
  const [reference, setReference] = useState('');
  const [notify, setNotify] = useState(true);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (reference.trim() && (await onSubmit(reference.trim(), notify))) setReference('');
  }
  return (
    <ActionCard title="Waiting for payment" hint={`Collect ${money(totalCents)}, then record how it was paid.`}>
      <form onSubmit={(e) => void submit(e)} className="action-form">
        <label className="field">
          <span>Payment reference</span>
          <input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="e.g. Zelle 10/21, check #1234" maxLength={200} />
        </label>
        <label className="check-line">
          <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} /> Email the customer
        </label>
        <button type="submit" className="btn btn-primary" disabled={busy || !reference.trim()}>
          Mark as paid
        </button>
      </form>
    </ActionCard>
  );
}

function ShipmentForm({
  busy,
  again,
  onSubmit,
}: {
  busy: boolean;
  again: boolean;
  onSubmit: (body: { carrier: string; service?: string; trackingNumber: string; notify: boolean }) => Promise<boolean>;
}) {
  const [carrier, setCarrier] = useState('ups');
  const [otherCarrier, setOtherCarrier] = useState('');
  const [service, setService] = useState('');
  const [tracking, setTracking] = useState('');
  const [notify, setNotify] = useState(true);
  const carrierName = carrier === 'other' ? otherCarrier.trim() : carrier;
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!carrierName || !tracking.trim()) return;
    const ok = await onSubmit({ carrier: carrierName, ...(service.trim() ? { service: service.trim() } : {}), trackingNumber: tracking.trim(), notify });
    if (ok) setTracking('');
  }
  return (
    <ActionCard title={again ? 'Add another package' : 'Ship it'} hint={again ? undefined : 'Adding tracking marks the order shipped.'}>
      <form onSubmit={(e) => void submit(e)} className="action-form">
        <div className="form-grid">
          <label className="field">
            <span>Carrier</span>
            <select value={carrier} onChange={(e) => setCarrier(e.target.value)}>
              {CARRIERS.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
          {carrier === 'other' ? (
            <label className="field">
              <span>Carrier name</span>
              <input value={otherCarrier} onChange={(e) => setOtherCarrier(e.target.value)} maxLength={40} />
            </label>
          ) : (
            <label className="field">
              <span>Service (optional)</span>
              <input value={service} onChange={(e) => setService(e.target.value)} placeholder="Ground, Priority…" maxLength={60} />
            </label>
          )}
        </div>
        <label className="field">
          <span>Tracking number</span>
          <input value={tracking} onChange={(e) => setTracking(e.target.value)} maxLength={60} />
        </label>
        <label className="check-line">
          <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} /> Email tracking to the customer
        </label>
        <button type="submit" className="btn btn-primary" disabled={busy || !carrierName || !tracking.trim()}>
          {again ? 'Add tracking' : 'Mark shipped'}
        </button>
      </form>
    </ActionCard>
  );
}

function ReferenceForm(props: { title: string; hint: string; placeholder: string; button: string; busy: boolean; onSubmit: (reference: string) => Promise<boolean> }) {
  const [reference, setReference] = useState('');
  return (
    <ActionCard title={props.title} hint={props.hint}>
      <form
        className="action-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (reference.trim()) void props.onSubmit(reference.trim()).then((ok) => ok && setReference(''));
        }}
      >
        <label className="field">
          <span>Reference</span>
          <input value={reference} onChange={(e) => setReference(e.target.value)} placeholder={props.placeholder} maxLength={200} />
        </label>
        <button type="submit" className="btn btn-primary" disabled={props.busy || !reference.trim()}>
          {props.button}
        </button>
      </form>
    </ActionCard>
  );
}

/** Two-step cancel (no browser confirm dialog): open the form, then confirm. */
function CancelForm({ busy, paid, onSubmit }: { busy: boolean; paid: boolean; onSubmit: (body: { reason?: string; notify: boolean }) => Promise<boolean> }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [notify, setNotify] = useState(true);
  if (!open) {
    return (
      <button type="button" className="btn btn-ghost btn-danger-text" onClick={() => setOpen(true)}>
        Cancel order…
      </button>
    );
  }
  return (
    <ActionCard title="Cancel this order" hint={paid ? 'It was paid: you will record the refund after cancelling.' : undefined} tone="danger">
      <form
        className="action-form"
        onSubmit={(e) => {
          e.preventDefault();
          void onSubmit({ ...(reason.trim() ? { reason: reason.trim() } : {}), notify });
        }}
      >
        <label className="field">
          <span>Reason (shown to the customer if emailed)</span>
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={500} />
        </label>
        <label className="check-line">
          <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} /> Email the customer
        </label>
        <div className="form-actions">
          <button type="submit" className="btn btn-danger" disabled={busy}>
            Cancel order
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>
            Keep order
          </button>
        </div>
      </form>
    </ActionCard>
  );
}
