import { useId } from 'react';
import { formatCents } from '../../lib/format';
import styles from './configurator.module.css';

interface Props {
  tiers: { quantity: number; isDefault: boolean; totalCents: number; unitPriceCents: number }[];
  value: number;
  onChange: (quantity: number) => void;
}

const qty = new Intl.NumberFormat('en-US');

export function QuantitySelect({ tiers, value, onChange }: Props) {
  const id = useId();
  return (
    <>
      <label htmlFor={id} className={styles.label}>
        Quantity
      </label>
      <select id={id} className={styles.select} value={value} onChange={(e) => onChange(Number(e.target.value))}>
        {tiers.map((tier) => (
          <option key={tier.quantity} value={tier.quantity}>
            {`${qty.format(tier.quantity)} cards · ${formatCents(tier.totalCents)} (${formatCents(tier.unitPriceCents)} each)${tier.isDefault ? ' · Recommended' : ''}`}
          </option>
        ))}
      </select>
    </>
  );
}
