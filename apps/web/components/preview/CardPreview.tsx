'use client';

import type { Catalog, ResolvedSize, Selection } from '@printing/pricing';
import dynamic from 'next/dynamic';
import { Component, useEffect, useMemo, useState, type ReactNode } from 'react';
import { cardSpec, finishLabel } from '../../lib/card3d';
import { formatInches } from '../../lib/format';
import { CardPlaceholder } from '../configurator/CardPlaceholder';
import type { ArtworkSvg, CardSide } from './CardScene';
import styles from './preview.module.css';

/** three.js is loaded only in the browser, after the page is interactive. */
const CardScene = dynamic(() => import('./CardScene'), { ssr: false });

function supportsWebGL(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return Boolean(canvas.getContext('webgl2') ?? canvas.getContext('webgl'));
  } catch {
    return false;
  }
}

/** Falls back to the flat preview if the 3D scene throws (driver issues, lost context...). */
class SceneBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

interface Props {
  catalog: Catalog;
  selection: Selection;
  size: ResolvedSize;
  artwork?: ArtworkSvg;
  /** Stretch to the parent's height instead of the default fixed stage height. */
  fill?: boolean;
}

export function CardPreview({ catalog, selection, size, artwork, fill = false }: Props) {
  const spec = useMemo(() => cardSpec(catalog, selection, size), [catalog, selection, size]);
  const [webgl, setWebgl] = useState<boolean | null>(null);
  const [autoRotate, setAutoRotate] = useState(true);
  const [turnRequest, setTurnRequest] = useState<{ side: CardSide; id: number } | null>(null);

  useEffect(() => setWebgl(supportsWebGL()), []);

  const flat = <CardPlaceholder catalog={catalog} selection={selection} size={size} />;
  if (webgl === false) return flat;

  function turn(side: CardSide) {
    setAutoRotate(false);
    setTurnRequest((prev) => ({ side, id: (prev?.id ?? 0) + 1 }));
  }

  const backLabel = spec.backMode === 'blank' ? 'Blank' : finishLabel(spec.backFinish);

  return (
    <div className={`${styles.wrapper} ${fill ? styles.wrapperFill : ''}`}>
      <div className={styles.stage}>
        {webgl && (
          <SceneBoundary fallback={flat}>
            <CardScene
              spec={spec}
              artwork={artwork}
              turnRequest={turnRequest}
              autoRotate={autoRotate}
              onUserInteract={() => setAutoRotate(false)}
            />
          </SceneBoundary>
        )}
        <div className={styles.controls}>
          <button type="button" className={styles.sideButton} onClick={() => turn('front')}>
            Front
          </button>
          <button type="button" className={styles.sideButton} onClick={() => turn('back')}>
            Back
          </button>
        </div>
        <p className={styles.hint}>Drag to rotate · Scroll to zoom</p>
      </div>
      <p className={styles.caption}>
        {formatInches(spec.widthIn)} × {formatInches(spec.heightIn)} · {Math.round(spec.thicknessIn * 1000)}pt · Front:{' '}
        {finishLabel(spec.frontFinish)} · Back: {backLabel}
        {spec.radiusIn > 0 ? ` · ${formatInches(spec.radiusIn)} rounded corners` : ''}
      </p>
    </div>
  );
}
