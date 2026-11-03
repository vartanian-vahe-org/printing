import type { OptionGroup } from '@printing/pricing';
import { useId } from 'react';
import { formatDelta } from '../../lib/format';
import styles from './configurator.module.css';

interface Props {
  group: OptionGroup;
  /** Selectable values; values hidden by rules are not rendered at all (see also `unavailable`). */
  allowed: string[];
  value: string;
  deltas: Record<string, number | null>;
  /** A second line per value, e.g. "Ships Thu, Nov 6". */
  notes?: Record<string, string>;
  /** Values shown dimmed and not selectable, with the reason, e.g. "Up to 5,000 cards". */
  unavailable?: Record<string, string>;
  onChange: (value: string) => void;
}

/** An option group as tiles that are all visible at once (turnaround), instead of a dropdown. */
export function OptionTiles({ group, allowed, value, deltas, notes = {}, unavailable = {}, onChange }: Props) {
  const name = useId();
  const visible = group.values
    .filter((v) => allowed.includes(v.code) || v.code in unavailable)
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const selected = group.values.find((v) => v.code === value);

  return (
    <fieldset className={styles.choiceGroup}>
      <legend className={styles.label}>{group.label}</legend>
      <div className={styles.tiles}>
        {visible.map((option) => {
          const reason = allowed.includes(option.code) ? null : unavailable[option.code]!;
          const delta = option.code === value || reason ? 0 : (deltas[option.code] ?? 0);
          return (
            <label key={option.code} className={styles.tile} data-selected={option.code === value || undefined} data-unavailable={reason ? true : undefined}>
              <input
                type="radio"
                className={styles.choiceInput}
                name={name}
                value={option.code}
                checked={option.code === value}
                disabled={Boolean(reason)}
                onChange={() => onChange(option.code)}
              />
              <span className={styles.tileLabel}>{option.label}</span>
              {(reason ?? notes[option.code]) && <span className={styles.tileNote}>{reason ?? notes[option.code]}</span>}
              {!reason && <span className={delta < 0 ? `${styles.tileHint} ${styles.tileSave}` : styles.tileHint}>{formatDelta(delta)}</span>}
            </label>
          );
        })}
      </div>
      {selected?.description && <p className={styles.hint}>{selected.description}</p>}
    </fieldset>
  );
}
