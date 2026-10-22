'use client';

import { useState, type FormEvent } from 'react';
import { approveProof, CheckoutError, replaceItemFile, requestDesignChanges, type OrderView, type ReplacementFile } from '../../lib/checkout';
import { openPdf, PdfReadError } from '../../lib/pdf-render';
import { uploadArtwork } from '../../lib/upload';
import styles from './order.module.css';

type Item = OrderView['items'][number];

interface Props {
  item: Item;
  orderNumber: number;
  token: string;
  /** Order still open to proof changes (not in production, shipped or cancelled). */
  editable: boolean;
  onChanged: () => void;
}

const SIDE_NAMES = ['Front', 'Back'];

/** Proof review for one item (spec §6.4): images with cut and safe lines, notes to confirm, approve or re-upload. */
export function ProofPanel({ item, orderNumber, token, editable, onChanged }: Props) {
  const { proof } = item;
  const [side, setSide] = useState(0);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showUpload, setShowUpload] = useState(false);

  const warnings = proof.issues.filter((i) => i.level === 'warning');
  const errors = proof.issues.filter((i) => i.level === 'error');
  const allChecked = warnings.every((w) => checked[w.id]);
  const isUpload = item.design.mode === 'upload';
  const service = item.design.mode === 'service' ? item.design : null;
  const image = proof.images[Math.min(side, proof.images.length - 1)];

  async function approve() {
    setBusy(true);
    setError(null);
    try {
      await approveProof(orderNumber, item.number, token, warnings.map((w) => w.id));
      onChanged();
    } catch (err) {
      setError(err instanceof CheckoutError ? err.message : 'Could not approve. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  // "Let us design it": the designer is making (or adjusting) the design. A designer's file that
  // failed the check is ours to fix, so the customer sees the same message.
  if (service && (proof.status === 'awaiting_design' || proof.status === 'needs_new_file' || (proof.status === 'pending' && !service.artwork))) {
    const lastRequest = service.changeRequests?.at(-1);
    return (
      <div className={styles.proof}>
        <p className={styles.proofStatus}>
          {lastRequest
            ? 'Thanks, we got your changes. Your designer will email you a new proof.'
            : `Our designer is working on your ${item.designService?.name ?? ''} design. We will email you the first proof${
                item.designService ? ` within ${item.designService.designDays} business day${item.designService.designDays === 1 ? '' : 's'}` : ''
              }.`}
        </p>
        {lastRequest && <blockquote className={styles.changeRequest}>{lastRequest.message}</blockquote>}
      </div>
    );
  }

  if (proof.status === 'pending') {
    return (
      <div className={styles.proof}>
        <p className={styles.proofStatus}>
          {proof.checkFailed ? 'Our team is looking at your file and will email you the proof.' : 'Checking your file and preparing your proof…'}
        </p>
      </div>
    );
  }

  return (
    <div className={styles.proof}>
      {image && (
        <figure className={styles.proofFigure}>
          {proof.images.length > 1 && (
            <div className={styles.proofTabs} role="tablist" aria-label="Card side">
              {proof.images.map((img, i) => (
                <button key={img.page} type="button" role="tab" aria-selected={side === i} className={side === i ? styles.proofTabActive : ''} onClick={() => setSide(i)}>
                  {SIDE_NAMES[i] ?? `Page ${img.page}`}
                </button>
              ))}
            </div>
          )}
          <img src={image.url} alt={`Proof of the ${(SIDE_NAMES[side] ?? '').toLowerCase()} of your card`} className={styles.proofImage} />
          <figcaption className={styles.proofLegend}>
            <span className={styles.legendCut}>Cut line</span>
            <span className={styles.legendSafe}>Safe zone: keep text inside</span>
            <span className={styles.legendBleed}>Shaded edge is trimmed off</span>
          </figcaption>
        </figure>
      )}

      {proof.status === 'approved' && (
        <p className={styles.proofApproved}>
          ✓ Proof approved{proof.approvedAt ? ` on ${new Date(proof.approvedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : ''}.
        </p>
      )}

      {proof.status === 'needs_new_file' && (
        <div className={styles.proofErrors} role="alert">
          <strong>We need a new file</strong>
          <ul>
            {errors.map((e) => (
              <li key={e.id}>{e.message}</li>
            ))}
          </ul>
          {!isUpload && <p>Reply to your order confirmation email and we will fix it with you.</p>}
        </div>
      )}

      {proof.status === 'awaiting_customer' && editable && (
        <div className={styles.proofReview}>
          {warnings.length > 0 && (
            <fieldset className={styles.proofWarnings}>
              <legend>Please read and confirm</legend>
              {warnings.map((w) => (
                <label key={w.id}>
                  <input type="checkbox" checked={Boolean(checked[w.id])} onChange={(e) => setChecked((c) => ({ ...c, [w.id]: e.target.checked }))} />
                  <span>{w.message}</span>
                </label>
              ))}
            </fieldset>
          )}
          <button type="button" className={styles.approveButton} disabled={busy || !allChecked} onClick={() => void approve()}>
            {busy ? 'Approving…' : 'Approve proof'}
          </button>
          <p className={styles.muted}>We print exactly what you see here. Spelling and contact details are your responsibility.</p>
          {service && (
            <ChangeRequestForm
              orderNumber={orderNumber}
              itemNumber={item.number}
              token={token}
              used={service.changeRequests?.length ?? 0}
              included={item.designService?.revisions ?? null}
              onDone={onChanged}
            />
          )}
        </div>
      )}

      {error && <p className={styles.error}>{error}</p>}

      {isUpload && editable && (proof.status === 'needs_new_file' || proof.status === 'awaiting_customer') && (
        <>
          {proof.status === 'awaiting_customer' && !showUpload ? (
            <button type="button" className={styles.linkButton} onClick={() => setShowUpload(true)}>
              Upload a different file instead
            </button>
          ) : (
            <ReplaceFileForm orderNumber={orderNumber} itemNumber={item.number} token={token} onDone={onChanged} />
          )}
        </>
      )}
    </div>
  );
}

function ReplaceFileForm({ orderNumber, itemNumber, token, onDone }: { orderNumber: number; itemNumber: number; token: string; onDone: () => void }) {
  const [front, setFront] = useState<File | null>(null);
  const [back, setBack] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function prepare(file: File): Promise<ReplacementFile> {
    const { pageCount } = await openPdf(file);
    const { key } = await uploadArtwork(file);
    return { key, fileName: file.name, pageCount };
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!front) return;
    setBusy(true);
    setError(null);
    try {
      const files = { front: await prepare(front), ...(back ? { back: await prepare(back) } : {}) };
      await replaceItemFile(orderNumber, itemNumber, token, files);
      onDone();
    } catch (err) {
      setError(err instanceof CheckoutError || err instanceof PdfReadError || err instanceof Error ? err.message : 'Upload failed. Please try again.');
      setBusy(false);
    }
  }

  return (
    <form className={styles.replaceForm} onSubmit={(e) => void submit(e)}>
      <strong>Upload a new file</strong>
      <label>
        <span>Front (or one PDF with front and back pages)</span>
        <input type="file" accept="application/pdf" onChange={(e) => setFront(e.target.files?.[0] ?? null)} />
      </label>
      <label>
        <span>Back (optional)</span>
        <input type="file" accept="application/pdf" onChange={(e) => setBack(e.target.files?.[0] ?? null)} />
      </label>
      <button type="submit" className={styles.approveButton} disabled={busy || !front}>
        {busy ? 'Uploading…' : 'Upload and check again'}
      </button>
      {error && <p className={styles.error}>{error}</p>}
    </form>
  );
}

/** "Let us design it": the customer tells the designer what to change instead of approving. */
function ChangeRequestForm(props: { orderNumber: number; itemNumber: number; token: string; used: number; included: number | null; onDone: () => void }) {
  const { orderNumber, itemNumber, token, used, included, onDone } = props;
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const left = included === null ? null : Math.max(0, included - used);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await requestDesignChanges(orderNumber, itemNumber, token, message.trim());
      onDone();
    } catch (err) {
      setError(err instanceof CheckoutError ? err.message : 'Could not send your changes. Please try again.');
      setBusy(false);
    }
  }

  if (left === 0) {
    return <p className={styles.muted}>You have used the {included} rounds of changes in your package. Reply to your order email if you need more.</p>;
  }
  if (!open) {
    return (
      <button type="button" className={styles.linkButton} onClick={() => setOpen(true)}>
        Ask the designer for changes{left !== null ? ` (${left} round${left === 1 ? '' : 's'} left)` : ''}
      </button>
    );
  }
  return (
    <form className={styles.replaceForm} onSubmit={(e) => void submit(e)}>
      <label>
        <strong>What should we change?</strong>
        <textarea rows={4} maxLength={3000} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="E.g. make the logo bigger, use a darker blue, fix the phone number…" />
      </label>
      <button type="submit" className={styles.approveButton} disabled={busy || message.trim().length < 5}>
        {busy ? 'Sending…' : 'Send changes'}
      </button>
      {error && <p className={styles.error}>{error}</p>}
    </form>
  );
}
