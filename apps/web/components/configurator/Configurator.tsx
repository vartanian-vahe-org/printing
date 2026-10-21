'use client';

import {
  CUSTOM_SIZE_VALUE,
  getAllowedValues,
  SIZE_GROUP,
  sortedGroups,
  type Catalog,
  type Selection,
} from '@printing/pricing';
import { renderFace, type MeasureText, type Template } from '@printing/templates';
import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { canvasMeasure } from '../../lib/browser-measure';
import { cardSpec } from '../../lib/card3d';
import { formatCents } from '../../lib/format';
import {
  changeCustomSize,
  changeOption,
  changeQuantity,
  customSizeAttributes,
  groupLabel,
  initialState,
  optionDeltas,
  priceOf,
  tierPrices,
  valueLabel,
  type AutoChange,
  type ConfiguratorState,
} from '../../lib/configurator-state';
import {
  ensureTemplateForSize,
  initialDesign,
  renderArtwork,
  templatesForSize,
  visibleFields,
  type DesignState,
} from '../../lib/design-state';
import { DesignPanel } from '../design/DesignPanel';
import { CardPreview } from '../preview/CardPreview';
import styles from './configurator.module.css';
import { CustomSizeInputs } from './CustomSizeInputs';
import { OptionSelect } from './OptionSelect';
import { PriceSummary } from './PriceSummary';
import { QuantitySelect } from './QuantitySelect';

interface Props {
  catalog: Catalog;
  defaults: { selection: Selection; quantity: number };
  templates: Template[];
}

export function Configurator({ catalog, defaults, templates }: Props) {
  const [state, setState] = useState(() => initialState(catalog, defaults));
  const [autoChanges, setAutoChanges] = useState<AutoChange[]>([]);
  const [design, setDesign] = useState<DesignState>(() => initialDesign(templates, state.selection[SIZE_GROUP] ?? ''));
  const [designNotice, setDesignNotice] = useState<string | null>(null);
  /** Which panel is shown when the screen is too narrow for three columns. */
  const [tab, setTab] = useState<'options' | 'design'>('options');
  // Real text measurement needs a browser canvas; the server render uses the built-in approximation.
  const [measure, setMeasure] = useState<MeasureText | undefined>(undefined);
  useEffect(() => setMeasure(() => canvasMeasure), []);

  const groups = useMemo(() => sortedGroups(catalog), [catalog]);
  const allowed = useMemo(() => getAllowedValues(catalog, state.selection), [catalog, state.selection]);
  const currentQuote = useMemo(() => priceOf(catalog, state), [catalog, state]);
  const deltas = useMemo(() => optionDeltas(catalog, state, allowed), [catalog, state, allowed]);
  const tiers = useMemo(() => tierPrices(catalog, state), [catalog, state]);
  const customAttrs = useMemo(() => customSizeAttributes(catalog), [catalog]);

  const size = currentQuote.size;
  const backMode = useMemo(() => cardSpec(catalog, state.selection, size).backMode, [catalog, state.selection, size]);
  const availableTemplates = useMemo(() => templatesForSize(templates, size.code), [templates, size.code]);
  const template = availableTemplates.find((t) => t.code === design.templateCode) ?? null;

  // Typing stays responsive; the artwork re-renders right after.
  const values = useDeferredValue(design.values);
  const artwork = useMemo(
    () => (template ? renderArtwork(template, values, size, backMode, measure) : null),
    [template, values, size, backMode, measure],
  );
  const thumbnails = useMemo(() => {
    const geometry = { widthIn: size.widthIn, heightIn: size.heightIn, bleedIn: size.bleedIn, safeIn: size.safeIn };
    return Object.fromEntries(
      availableTemplates.map((t) => [t.code, renderFace({ layout: t.layout, side: 'front', values, geometry, measure }).svg]),
    );
  }, [availableTemplates, values, size, measure]);

  /** Applies a new configurator state and keeps the template valid for the (possibly new) size. */
  function apply(next: ConfiguratorState, changes: AutoChange[]) {
    setState(next);
    setAutoChanges(changes);
    const nextSize = priceOf(catalog, next).size.code;
    const { design: fixed, replaced } = ensureTemplateForSize(templates, design, nextSize);
    if (replaced) {
      setDesign(fixed);
      const now = templates.find((t) => t.code === fixed.templateCode);
      setDesignNotice(
        now
          ? `The ${replaced.name} template is not available for this size, so we switched to ${now.name}. Your text is kept.`
          : null,
      );
    }
  }

  return (
    <div className={styles.studio} data-tab={tab}>
      <div className={styles.tabs} role="tablist" aria-label="Configure your card">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'options'}
          className={styles.tab}
          onClick={() => setTab('options')}
        >
          Options
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'design'}
          className={styles.tab}
          onClick={() => setTab('design')}
        >
          Design
        </button>
        <span className={styles.tabTotal}>{formatCents(currentQuote.totalCents)}</span>
      </div>

      <section className={`${styles.column} ${styles.optionsColumn}`} aria-label="Card options">
        <div className={styles.columnBody}>
          <h2 className={styles.columnTitle}>Options</h2>
          {groups.map((group) => (
            <div key={group.code} className={styles.field}>
              <OptionSelect
                group={group}
                allowed={allowed[group.code] ?? []}
                value={state.selection[group.code] ?? ''}
                deltas={deltas[group.code] ?? {}}
                onChange={(value) => {
                  const result = changeOption(catalog, state, group.code, value);
                  apply(result.state, result.autoChanges);
                }}
              />
              {group.code === SIZE_GROUP && state.selection[SIZE_GROUP] === CUSTOM_SIZE_VALUE && customAttrs && (
                <CustomSizeInputs
                  attributes={customAttrs}
                  value={state.customSize}
                  onChange={(customSize) => {
                    const result = changeCustomSize(catalog, state, customSize);
                    apply(result.state, result.autoChanges);
                  }}
                />
              )}
            </div>
          ))}

          <div className={styles.field}>
            <QuantitySelect
              tiers={tiers}
              value={state.quantity}
              onChange={(quantity) => apply(changeQuantity(state, quantity), [])}
            />
          </div>

          <div aria-live="polite">
            {autoChanges.length > 0 && (
              <div className={styles.notice}>
                {autoChanges.map((change) => (
                  <p key={change.group}>
                    {groupLabel(catalog, change.group)} changed to{' '}
                    <strong>{valueLabel(catalog, change.group, change.to)}</strong> to match your other choices.
                  </p>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className={styles.priceDock}>
          <PriceSummary quote={currentQuote} />
        </div>
      </section>

      <section className={styles.previewColumn} aria-label="Card preview">
        <CardPreview
          fill
          catalog={catalog}
          selection={state.selection}
          size={size}
          artwork={artwork ? { front: artwork.frontSvg, back: artwork.backSvg } : undefined}
        />
      </section>

      <section className={`${styles.column} ${styles.designColumn}`} aria-label="Design">
        <div className={styles.columnBody}>
          <h2 className={styles.columnTitle}>Your design</h2>
          <p className={styles.columnText}>Pick a template and fill in your details. Your card updates as you type.</p>
          <DesignPanel
            templates={availableTemplates}
            selected={template}
            thumbnails={thumbnails}
            fields={template ? visibleFields(template, backMode) : []}
            values={design.values}
            warnings={artwork?.warnings ?? []}
            notice={designNotice}
            onSelectTemplate={(code) => {
              setDesign((d) => ({ ...d, templateCode: code }));
              setDesignNotice(null);
            }}
            onChangeValue={(key, value) => setDesign((d) => ({ ...d, values: { ...d.values, [key]: value } }))}
          />
        </div>
      </section>
    </div>
  );
}
