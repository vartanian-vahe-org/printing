import { useEffect, useId, useState } from 'react';
import { formatCents } from '../../lib/format';
import styles from './configurator.module.css';

interface Props {
  tiers: { quantity: number; isDefault: boolean; totalCents: number; unitPriceCents: number }[];
  value: number;
  onChange: (quantity: number) => void;
}

const qty = new Intl.NumberFormat('en-US');

/** True on narrow screens, where long option text gets cut off in the closed select (U3). */
function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const query = window.matchMedia('(max-width: 520px)');
    const update = () => setNarrow(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return narrow;
}

export function QuantitySelect({ tiers, value, onChange }: Props) {
  const id = useId();
  const narrow = useNarrow();
  const selected = tiers.find((t) => t.quantity === value);
  const label = (tier: Props['tiers'][number]) =>
    narrow
      ? `${qty.format(tier.quantity)} cards – ${formatCents(tier.totalCents)}${tier.isDefault ? ' ★' : ''}`
      : `${qty.format(tier.quantity)} cards · ${formatCents(tier.totalCents)} (${formatCents(tier.unitPriceCents)} each)${tier.isDefault ? ' · Recommended' : ''}`;

  return (
    <>
      <label htmlFor={id} className={styles.label}>
        Quantity
      </label>
      <select id={id} className={styles.select} value={value} onChange={(e) => onChange(Number(e.target.value))} aria-describedby={`${id}-hint`}>
        {tiers.map((tier) => (
          <option key={tier.quantity} value={tier.quantity}>
            {label(tier)}
          </option>
        ))}
      </select>
      {selected && (
        <p id={`${id}-hint`} className={styles.hint}>
          {formatCents(selected.unitPriceCents)} each{selected.isDefault ? ' · our most popular quantity' : ''}
        </p>
      )}
    </>
  );
}
