'use client';

import type { DesignServiceTier } from '@printing/templates';
import { useId } from 'react';
import { BRIEF_FIELDS, type BriefFieldDef } from '../../lib/brief-fields';
import type { BriefFile, BriefState } from '../../lib/cart-design';
import { formatCents } from '../../lib/format';
import { REFERENCE_TYPES, uploadReference, UploadError } from '../../lib/upload';
import styles from './design.module.css';
import { revisionsText } from './ServiceTiers';

const MAX_FILES = 5;

interface Props {
  tier: DesignServiceTier | null;
  brief: BriefState;
  /** Functional updates: uploads finish after other edits. */
  onChange: (update: (brief: BriefState) => BriefState) => void;
  onChangeTier: () => void;
}

/** Step 3 with "let us design it": what our designer needs to make the card. */
export function BriefForm({ tier, brief, onChange, onChangeTier }: Props) {
  const formId = useId();
  const notesId = useId();
  const filesId = useId();

  function addFiles(list: FileList | null) {
    const picked = [...(list ?? [])].slice(0, MAX_FILES - brief.files.length);
    for (const file of picked) {
      const id = crypto.randomUUID();
      const entry: BriefFile = { id, fileName: file.name, status: 'uploading' };
      onChange((b) => ({ ...b, files: [...b.files, entry] }));
      const update = (patch: Partial<BriefFile>) => onChange((b) => ({ ...b, files: b.files.map((f) => (f.id === id ? { ...f, ...patch } : f)) }));
      uploadReference(file).then(
        ({ key }) => update({ status: 'done', key }),
        (err: unknown) => update({ status: 'error', error: err instanceof UploadError ? err.message : 'Upload failed' }),
      );
    }
  }

  return (
    <div className={styles.panel}>
      <div className={styles.chosen}>
        <span>
          Design package: <strong>{tier ? `${tier.name} · ${formatCents(tier.priceCents)}` : 'not chosen'}</strong>
        </span>
        <button type="button" className={styles.linkButton} onClick={onChangeTier}>
          Change package
        </button>
      </div>
      {tier && (
        <p className={styles.helper}>
          Your designer emails a proof within {tier.designDays} business day{tier.designDays === 1 ? '' : 's'} of your order. {revisionsText(tier.revisions)} included
          before we print.
        </p>
      )}

      <fieldset className={styles.briefSection}>
        <legend className={styles.briefTitle}>What should your card say?</legend>
        <p className={styles.hint}>Type it exactly as it should be printed. Leave out anything you don't want on the card.</p>
        <div className={styles.briefGrid}>
          {BRIEF_FIELDS.map((field) => (
            <BriefInput
              key={field.key}
              id={`${formId}-${field.key}`}
              field={field}
              value={brief.fields[field.key] ?? ''}
              onChange={(value) => onChange((b) => ({ ...b, fields: { ...b.fields, [field.key]: value } }))}
            />
          ))}
        </div>
      </fieldset>

      <div className={styles.field}>
        <label htmlFor={notesId} className={styles.label}>
          Describe the look you want <span className={styles.optional}>(optional)</span>
        </label>
        <textarea
          id={notesId}
          className={`${styles.input} ${styles.textarea}`}
          rows={4}
          maxLength={3000}
          value={brief.notes}
          placeholder="Colors, style, designs you like, anything to avoid…"
          onChange={(e) => onChange((b) => ({ ...b, notes: e.target.value }))}
        />
      </div>

      <div className={styles.field}>
        <span className={styles.label}>
          Logo and reference files <span className={styles.optional}>(optional)</span>
        </span>
        {brief.files.length > 0 && (
          <ul className={styles.briefFiles}>
            {brief.files.map((file) => (
              <li key={file.id} data-state={file.status}>
                <span className={styles.fileName}>{file.fileName}</span>
                <span className={styles.uploadState} data-state={file.status === 'error' ? 'failed' : file.status}>
                  {file.status === 'uploading' ? 'Uploading…' : file.status === 'done' ? 'Uploaded' : file.error}
                </span>
                <button
                  type="button"
                  className={styles.linkButton}
                  onClick={() => onChange((b) => ({ ...b, files: b.files.filter((f) => f.id !== file.id) }))}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
        {brief.files.length < MAX_FILES && (
          <div className={styles.logoRow}>
            <label htmlFor={filesId} className={styles.fileButton}>
              Add files
            </label>
            <input
              id={filesId}
              type="file"
              multiple
              accept={REFERENCE_TYPES.join(',')}
              className={styles.fileInput}
              onChange={(e) => {
                addFiles(e.target.files);
                e.target.value = '';
              }}
            />
          </div>
        )}
        <span className={styles.hint}>Up to {MAX_FILES} files: PNG, JPG, WebP, SVG or PDF, 25 MB each. Your logo, photos, or cards you like.</span>
      </div>
    </div>
  );
}

function BriefInput({ id, field, value, onChange }: { id: string; field: BriefFieldDef; value: string; onChange: (value: string) => void }) {
  const common = {
    id,
    className: field.multiline ? `${styles.input} ${styles.textarea}` : styles.input,
    value,
    maxLength: field.maxLength,
    placeholder: field.placeholder,
    autoComplete: field.autoComplete ?? 'off',
  };
  return (
    <div className={`${styles.field} ${field.wide ? styles.briefWide : ''}`}>
      <label htmlFor={id} className={styles.label}>
        {field.label}
      </label>
      {field.multiline ? (
        <textarea {...common} rows={field.key === 'address' ? 2 : 3} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <input {...common} type={field.type ?? 'text'} onChange={(e) => onChange(e.target.value)} />
      )}
    </div>
  );
}

