'use client';

import type { UploadProof } from '../../lib/cart';
import styles from './configurator.module.css';

const OPTIONS: { value: UploadProof; title: string; text: string }[] = [
  { value: 'send', title: 'Send me a proof to approve', text: 'Free. We email it after you order; printing starts once you approve.' },
  { value: 'skip', title: 'Print right away', text: 'Only if your file is print-ready. We still stop if our file check finds a problem.' },
];

/** Uploaded designs: a proof after ordering, or straight to print (as on UPrinting and 48HourPrint). */
export function ProofChoice({ value, onChange }: { value: UploadProof; onChange: (value: UploadProof) => void }) {
  return (
    <fieldset className={styles.proofChoice}>
      <legend>Proof</legend>
      {OPTIONS.map((option) => (
        <label key={option.value} className={styles.proofOption}>
          <input type="radio" name="upload-proof" value={option.value} checked={value === option.value} onChange={() => onChange(option.value)} />
          <span>
            <strong>{option.title}</strong>
            <small>{option.text}</small>
          </span>
        </label>
      ))}
    </fieldset>
  );
}
