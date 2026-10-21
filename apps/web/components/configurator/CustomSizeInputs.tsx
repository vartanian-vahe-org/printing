import type { CustomSize, CustomSizeAttributes } from '@printing/pricing';
import { useId } from 'react';
import { customSizeSteps } from '../../lib/configurator-state';
import { formatInches } from '../../lib/format';
import styles from './configurator.module.css';

interface Props {
  attributes: CustomSizeAttributes;
  value: CustomSize;
  onChange: (size: CustomSize) => void;
}

export function CustomSizeInputs({ attributes, value, onChange }: Props) {
  const widthId = useId();
  const heightId = useId();
  const steps = customSizeSteps(attributes);

  return (
    <div className={styles.customSize}>
      <div className={styles.customSizeField}>
        <label htmlFor={widthId} className={styles.smallLabel}>
          Width
        </label>
        <select
          id={widthId}
          className={styles.select}
          value={value.widthIn}
          onChange={(e) => onChange({ ...value, widthIn: Number(e.target.value) })}
        >
          {steps.map((step) => (
            <option key={step} value={step}>
              {formatInches(step)}
            </option>
          ))}
        </select>
      </div>
      <span className={styles.times} aria-hidden="true">
        ×
      </span>
      <div className={styles.customSizeField}>
        <label htmlFor={heightId} className={styles.smallLabel}>
          Height
        </label>
        <select
          id={heightId}
          className={styles.select}
          value={value.heightIn}
          onChange={(e) => onChange({ ...value, heightIn: Number(e.target.value) })}
        >
          {steps.map((step) => (
            <option key={step} value={step}>
              {formatInches(step)}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
