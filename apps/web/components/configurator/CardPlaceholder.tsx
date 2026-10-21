import type { Catalog, ResolvedSize, Selection } from '@printing/pricing';
import { formatInches } from '../../lib/format';
import styles from './configurator.module.css';

interface Props {
  catalog: Catalog;
  selection: Selection;
  size: ResolvedSize;
}

function attributesOf(catalog: Catalog, group: string, value: string | undefined) {
  return catalog.groups.find((g) => g.code === group)?.values.find((v) => v.code === value)?.attributes ?? {};
}

/**
 * Temporary flat preview (true proportions, corner radius and finish hint).
 * Replaced by the 3D preview in Phase 1 step 6.
 */
export function CardPlaceholder({ catalog, selection, size }: Props) {
  const paper = attributesOf(catalog, 'paper', selection.paper);
  const coating = attributesOf(catalog, 'coating', selection.coating);
  const corners = attributesOf(catalog, 'corners', selection.corners);

  const radiusIn = Number(corners.radius_in ?? 0);
  const finish = String(coating.front ?? 'matte');
  const longest = Math.max(size.widthIn, size.heightIn);

  return (
    <div className={styles.previewStage}>
      <div
        className={styles.card}
        data-finish={finish}
        style={{
          width: `${(size.widthIn / longest) * 100}%`,
          aspectRatio: `${size.widthIn} / ${size.heightIn}`,
          borderRadius: `${(radiusIn / size.widthIn) * 100}% / ${(radiusIn / size.heightIn) * 100}%`,
        }}
      >
        <span className={styles.cardName}>Your Name</span>
        <span className={styles.cardTitle}>Job Title · Company</span>
      </div>
      <p className={styles.previewCaption}>
        {formatInches(size.widthIn)} × {formatInches(size.heightIn)} · {String(paper.thickness_pt ?? '')}pt ·{' '}
        {finish === 'none' ? 'uncoated' : finish.replace('_', ' ')} front
      </p>
    </div>
  );
}
