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

/** An option group as tiles that are all visible at once (turnaround), instead of a dropdown. */
export function OptionTiles({ group, allowed, value, deltas, onChange }: Props) {
  const name = useId();
  const visible = group.values.filter((v) => allowed.includes(v.code)).sort((a, b) => a.sortOrder - b.sortOrder);
  const selected = group.values.find((v) => v.code === value);

  return (
    <fieldset className={styles.choiceGroup}>
      <legend className={styles.label}>{group.label}</legend>
      <div className={styles.tiles}>
        {visible.map((option) => {
          const delta = option.code === value ? 0 : (deltas[option.code] ?? 0);
          return (
            <label key={option.code} className={styles.tile} data-selected={option.code === value || undefined}>
              <input
                type="radio"
                className={styles.choiceInput}
                name={name}
                value={option.code}
                checked={option.code === value}
                onChange={() => onChange(option.code)}
              />
              <span className={styles.tileLabel}>{option.label}</span>
              <span className={delta < 0 ? `${styles.tileHint} ${styles.tileSave}` : styles.tileHint}>{formatDelta(delta)}</span>
            </label>
          );
        })}
      </div>
      {selected?.description && <p className={styles.hint}>{selected.description}</p>}
    </fieldset>
  );
}
