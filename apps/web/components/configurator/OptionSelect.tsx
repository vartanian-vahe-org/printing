import type { OptionGroup } from '@printing/pricing';
import { useId } from 'react';
import { formatDelta } from '../../lib/format';
import styles from './configurator.module.css';

interface Props {
  group: OptionGroup;
  /** Only these values are shown; values hidden by rules are not rendered at all. */
  allowed: string[];
  value: string;
  deltas: Record<string, number | null>;
  onChange: (value: string) => void;
}

export function OptionSelect({ group, allowed, value, deltas, onChange }: Props) {
  const id = useId();
  const visible = group.values.filter((v) => allowed.includes(v.code)).sort((a, b) => a.sortOrder - b.sortOrder);
  const selected = group.values.find((v) => v.code === value);

  return (
    <>
      <label htmlFor={id} className={styles.label}>
        {group.label}
      </label>
      <select id={id} className={styles.select} value={value} onChange={(e) => onChange(e.target.value)}>
        {visible.map((option) => {
          const delta = option.code === value ? 0 : (deltas[option.code] ?? 0);
          const hint = formatDelta(delta);
          return (
            <option key={option.code} value={option.code}>
              {hint ? `${option.label}  (${hint})` : option.label}
            </option>
          );
        })}
      </select>
      {selected?.description && <p className={styles.hint}>{selected.description}</p>}
    </>
  );
}
