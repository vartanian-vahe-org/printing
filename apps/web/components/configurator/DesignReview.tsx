'use client';

import type { TemplateField } from '@printing/templates';
import styles from './configurator.module.css';

interface Props {
  fields: TemplateField[];
  values: Record<string, string>;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

/**
 * Template designs: the customer approves the preview before adding to the cart (as on
 * Vistaprint), so no proof is sent after ordering. Empty fields are not printed: say which.
 */
export function DesignReview({ fields, values, checked, onChange }: Props) {
  const empty = fields.filter((f) => !values[f.key]?.trim()).map((f) => f.label);
  return (
    <div className={styles.review}>
      <strong>Review your design</strong>
      <ul>
        <li>Text is clear and easy to read</li>
        <li>Names, phone numbers and emails are spelled correctly</li>
        <li>Your logo is sharp, not blurry</li>
      </ul>
      {empty.length > 0 && (
        <p className={styles.reviewWarning}>
          Not printed because they are empty: {empty.join(', ')}. The sample text you see there is only a preview.
        </p>
      )}
      <label className={styles.reviewCheck}>
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <span>I have reviewed and approve my design. We print exactly what you see.</span>
      </label>
    </div>
  );
}
