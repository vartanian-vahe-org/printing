'use client';

import type { DesignServiceTier } from '@printing/templates';
import { formatCents } from '../../lib/format';
import styles from './choose.module.css';

interface Props {
  tiers: DesignServiceTier[];
  selectedCode: string | null;
  onSelect: (code: string) => void;
}

export function revisionsText(revisions: number | null): string {
  if (revisions === null) return 'Unlimited changes';
  return `${revisions} round${revisions === 1 ? '' : 's'} of changes`;
}

/** Step 2 with "let us design it": the packages and what each includes. */
export function ServiceTiers({ tiers, selectedCode, onSelect }: Props) {
  if (tiers.length === 0) return <p className={styles.empty}>Our design service is not available for this product right now.</p>;

  return (
    <div className={styles.serviceIntro}>
      <ol className={styles.serviceSteps}>
        <li>Choose a package and tell us what to put on your card.</li>
        <li>Our designer emails you a proof.</li>
        <li>Ask for changes or approve it, then we print.</li>
      </ol>
      <ul className={styles.tiers}>
        {tiers.map((tier) => (
          <li key={tier.code} className={styles.tier} aria-current={tier.code === selectedCode || undefined}>
            <h3 className={styles.tierName}>{tier.name}</h3>
            <p className={styles.tierPrice}>
              {formatCents(tier.priceCents)}
              <span> design fee</span>
            </p>
            {tier.description && <p className={styles.tierText}>{tier.description}</p>}
            <ul className={styles.tierFeatures}>
              {tier.features.map((feature) => (
                <li key={feature}>{feature}</li>
              ))}
            </ul>
            <p className={styles.tierMeta}>
              First draft in {tier.designDays} business day{tier.designDays === 1 ? '' : 's'} · {revisionsText(tier.revisions)}
            </p>
            <button type="button" className={styles.tierButton} onClick={() => onSelect(tier.code)}>
              Choose {tier.name}
            </button>
          </li>
        ))}
      </ul>
      <p className={styles.finePrint}>The design fee is added to the price of your printed cards, once per design.</p>
    </div>
  );
}
