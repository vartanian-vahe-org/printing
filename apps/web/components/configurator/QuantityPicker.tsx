import { useId } from 'react';
import { formatCents } from '../../lib/format';
import styles from './configurator.module.css';

interface Props {
  tiers: { quantity: number; isDefault: boolean; totalCents: number; unitPriceCents: number }[];
  value: number;
  onChange: (quantity: number) => void;
}

const qty = new Intl.NumberFormat('en-US');

/** Every quantity on screen at once with its total and unit price, so customers compare without opening a list. */
export function QuantityPicker({ tiers, value, onChange }: Props) {
  const name = useId();

  return (
    <fieldset className={styles.choiceGroup}>
      <legend className={styles.label}>Quantity</legend>
      <div className={styles.quantityList}>
        {tiers.map((tier) => (
          <label key={tier.quantity} className={styles.quantityRow} data-selected={tier.quantity === value || undefined}>
            <input
              type="radio"
              className={styles.choiceInput}
              name={name}
              value={tier.quantity}
              checked={tier.quantity === value}
              onChange={() => onChange(tier.quantity)}
            />
            <span className={styles.quantityCount}>
              {qty.format(tier.quantity)}
              {tier.isDefault && <span className={styles.choiceBadge}>Popular</span>}
            </span>
            <span className={styles.quantityTotal}>{formatCents(tier.totalCents)}</span>
            <span className={styles.quantityEach}>{formatCents(tier.unitPriceCents)} each</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
