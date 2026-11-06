import type { Quote } from '@printing/pricing';
import { formatCents, formatDelta } from '../../lib/format';
import styles from './configurator.module.css';

const qty = new Intl.NumberFormat('en-US');

interface Props {
  quote: Quote;
  /** What the customer is ordering, e.g. "flyers". */
  unitNamePlural: string;
  /** "Let us design it" package, charged once on top of the printing. */
  designFee?: { name: string; priceCents: number } | null;
}

export function PriceSummary({ quote, unitNamePlural, designFee = null }: Props) {
  const addOns = quote.lines.filter((line) => line.upchargeCents !== 0);
  const totalCents = quote.totalCents + (designFee?.priceCents ?? 0);

  return (
    <div className={styles.price}>
      <div className={styles.priceRow}>
        <span className={styles.priceTotal}>{formatCents(totalCents)}</span>
        <span className={styles.priceEach}>
          {qty.format(quote.quantity)} {unitNamePlural} · {formatCents(quote.unitPriceCents)} each
          {designFee ? ` + ${designFee.name} design` : ''}
        </span>
      </div>

      <details className={styles.breakdown}>
        <summary>Price breakdown</summary>
        <dl>
          <div>
            <dt>{qty.format(quote.quantity)} {unitNamePlural}</dt>
            <dd>{formatCents(quote.corePriceCents)}</dd>
          </div>
          {addOns.map((line) => (
            <div key={line.group}>
              <dt>
                {line.groupLabel}: {line.valueLabel}
              </dt>
              <dd>{formatDelta(line.upchargeCents)}</dd>
            </div>
          ))}
          {designFee && (
            <div>
              <dt>{designFee.name} design service</dt>
              <dd>{formatDelta(designFee.priceCents)}</dd>
            </div>
          )}
          <div className={styles.breakdownTotal}>
            <dt>Total</dt>
            <dd>{formatCents(totalCents)}</dd>
          </div>
        </dl>
      </details>
      <p className={styles.finePrint}>Shipping and tax are calculated at checkout.</p>
    </div>
  );
}
