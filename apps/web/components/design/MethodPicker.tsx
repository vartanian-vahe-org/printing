'use client';

import { formatCents } from '../../lib/format';
import styles from './choose.module.css';

export type DesignMethod = 'upload' | 'template' | 'service';

interface Props {
  value: DesignMethod | null;
  templateCount: number;
  /** Cheapest design package, or null when the service is not offered. */
  servicePriceFrom: number | null;
  onChange: (method: DesignMethod) => void;
}

/** Step 2: the three ways to get a design onto the card. */
export function MethodPicker({ value, templateCount, servicePriceFrom, onChange }: Props) {
  const methods: { code: DesignMethod; title: string; text: string; meta: string; icon: string }[] = [
    {
      code: 'upload',
      title: 'Upload your design',
      text: 'Already have a print-ready file? Upload the front and back as PDF.',
      meta: 'PDF · free file check',
      icon: '⬆',
    },
    {
      code: 'template',
      title: 'Choose a template',
      text: 'Pick a design, add your details and logo, and see it live.',
      meta: `${templateCount} template${templateCount === 1 ? '' : 's'}`,
      icon: '▦',
    },
    ...(servicePriceFrom !== null
      ? [
          {
            code: 'service' as const,
            title: 'Let us design it for you',
            text: 'Tell us what you need. A designer sends you a proof to approve.',
            meta: `From ${formatCents(servicePriceFrom)}`,
            icon: '✎',
          },
        ]
      : []),
  ];

  return (
    <div className={styles.methods} role="radiogroup" aria-label="How do you want to design your card?">
      {methods.map((method) => (
        <button
          key={method.code}
          type="button"
          role="radio"
          aria-checked={value === method.code}
          className={styles.method}
          onClick={() => onChange(method.code)}
        >
          <span className={styles.methodIcon} aria-hidden="true">
            {method.icon}
          </span>
          <span className={styles.methodTitle}>{method.title}</span>
          <span className={styles.methodText}>{method.text}</span>
          <span className={styles.methodMeta}>{method.meta}</span>
        </button>
      ))}
    </div>
  );
}
