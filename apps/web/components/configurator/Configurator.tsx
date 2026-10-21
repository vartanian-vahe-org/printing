'use client';

import {
  CUSTOM_SIZE_VALUE,
  getAllowedValues,
  resolveSelection,
  SIZE_GROUP,
  sortedGroups,
  turnaroundDays,
  type Catalog,
  type ProductionCalendar,
  type Selection,
} from '@printing/pricing';
import { layoutFace, type MeasureText, type Template } from '@printing/templates';
import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { canvasMeasure } from '../../lib/browser-measure';
import { clearDraft, loadDraft, saveDraft } from '../../lib/design-draft';
import { editingItemId, loadItemToEdit } from '../../lib/edit-cart-item';
import { loadTemplateFonts } from '../../lib/template-fonts';
import { useScenePngs } from '../../lib/use-scene-png';
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
  layoutArtwork,
  templatesForSize,
  visibleFields,
  type DesignState,
} from '../../lib/design-state';
import { useArtworkSources, usePageImage, usePdfFiles } from '../../lib/use-pdf-artwork';
import { DesignPanel } from '../design/DesignPanel';
import { UploadPanel } from '../design/UploadPanel';
import designStyles from '../design/design.module.css';
import { CardPreview } from '../preview/CardPreview';
import { AddToCart } from './AddToCart';
import { logoFieldKey, prepareTemplateDesign, prepareUploadDesign } from '../../lib/cart-design';
import styles from './configurator.module.css';
import { CustomSizeInputs } from './CustomSizeInputs';
import { OptionSelect } from './OptionSelect';
import { PriceSummary } from './PriceSummary';
import { ShipEstimate } from './ShipEstimate';
import { QuantitySelect } from './QuantitySelect';

/** 300 pixels per inch for the 3D card textures; small thumbnails need far less. */
const TEXTURE_PX_PER_PT = 300 / 72;
const THUMBNAIL_PX_PER_PT = 1.2;

interface Props {
  catalog: Catalog;
  defaults: { selection: Selection; quantity: number };
  calendar: ProductionCalendar;
  templates: Template[];
}

export function Configurator({ catalog, defaults, calendar, templates }: Props) {
  const [state, setState] = useState(() => initialState(catalog, defaults));
  const [autoChanges, setAutoChanges] = useState<AutoChange[]>([]);
  const [design, setDesign] = useState<DesignState>(() => initialDesign(templates, state.selection[SIZE_GROUP] ?? ''));
  const [designNotice, setDesignNotice] = useState<string | null>(null);
  /** Which panel is shown when the screen is too narrow for three columns. */
  const [tab, setTab] = useState<'options' | 'design'>('options');
  /** Design source: fill a template, or upload a print-ready PDF. */
  const [mode, setMode] = useState<'template' | 'upload'>('template');
  const pdf = usePdfFiles();
  /** Cart item being edited (/business-cards?edit=<id>), saved back instead of added. */
  const [editingId, setEditingId] = useState<string | null>(null);
  // Unsaved design from an earlier visit (U7); saved as the customer works, cleared once in the cart.
  const [draftReady, setDraftReady] = useState(false);
  useEffect(() => {
    if (editingItemId()) return;
    const draft = loadDraft();
    if (draft && draft.design.templateCode && templates.some((t) => t.code === draft.design.templateCode)) {
      setState({ ...draft.state, selection: resolveSelection(catalog, draft.state.selection) });
      setDesign(draft.design);
      setMode(draft.mode === 'upload' ? 'upload' : 'template');
    }
    setDraftReady(true);
  }, [catalog, templates]);
  useEffect(() => {
    if (!draftReady || editingId) return;
    const timer = setTimeout(() => saveDraft({ state, design, mode }), 400);
    return () => clearTimeout(timer);
  }, [draftReady, editingId, state, design, mode]);

  useEffect(() => {
    const id = editingItemId();
    if (!id) return;
    void loadItemToEdit(id)
      .then((loaded) => {
        if (!loaded) {
          setDesignNotice('That cart item is no longer in your cart. You are designing a new one.');
          return;
        }
        const { item, logoDataUrl, files } = loaded;
        setEditingId(item.id);
        setState((s) => ({
          selection: resolveSelection(catalog, item.configuration.selection),
          quantity: item.quantity,
          customSize: item.configuration.customSize ?? s.customSize,
        }));
        if (item.design.mode === 'template') {
          const editedTemplate = templates.find((t) => t.code === (item.design as { templateCode: string }).templateCode);
          const logoKey = editedTemplate ? logoFieldKey(editedTemplate) : null;
          setMode('template');
          setDesign({
            templateCode: item.design.templateCode,
            values: { ...item.design.values, ...(logoKey && logoDataUrl ? { [logoKey]: logoDataUrl } : {}) },
          });
        } else {
          setMode('upload');
          if (files.front) void pdf.addFile('front', files.front);
          if (files.back) void pdf.addFile('back', files.back);
        }
      })
      .catch(() => setDesignNotice('Could not load that cart item.'));
    // Runs once on arrival (pdf.addFile is stable; catalog and templates come from the server render).
  }, []);
  // Real text measurement needs a browser canvas and the template fonts (the same files the print
  // PDF embeds); until they load, layout uses the built-in approximation.
  const [measure, setMeasure] = useState<MeasureText | undefined>(undefined);
  useEffect(() => {
    const ready = () => setMeasure(() => canvasMeasure);
    loadTemplateFonts().then(ready, ready);
  }, []);

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
    () => (template ? layoutArtwork(template, values, size, backMode, measure) : null),
    [template, values, size, backMode, measure],
  );
  const artworkScenes = useMemo(() => ({ front: artwork?.front ?? null, back: artwork?.back ?? null }), [artwork]);
  const artworkImages = useScenePngs(artworkScenes, TEXTURE_PX_PER_PT);
  const thumbnailScenes = useMemo(() => {
    const geometry = { widthIn: size.widthIn, heightIn: size.heightIn, bleedIn: size.bleedIn, safeIn: size.safeIn };
    return Object.fromEntries(availableTemplates.map((t) => [t.code, layoutFace({ layout: t.layout, side: 'front', values, geometry, measure })]));
  }, [availableTemplates, values, size, measure]);
  const thumbnails = useScenePngs(thumbnailScenes, THUMBNAIL_PX_PER_PT);

  const expectedSize = useMemo(
    () => ({ widthIn: size.widthIn, heightIn: size.heightIn, bleedIn: size.bleedIn }),
    [size.widthIn, size.heightIn, size.bleedIn],
  );
  const pdfSources = useArtworkSources(pdf.files, expectedSize, backMode);
  const pdfFront = usePageImage(mode === 'upload' ? pdfSources.front : null);
  const pdfBack = usePageImage(mode === 'upload' ? pdfSources.back : null);

  const previewImages =
    mode === 'upload'
      ? { front: pdfFront, back: pdfBack }
      : artwork && artworkImages.front
        ? { front: artworkImages.front, back: artworkImages.back ?? null }
        : undefined;

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
          <ShipEstimate calendar={calendar} businessDays={turnaroundDays(catalog, currentQuote.selection)} />
          <AddToCart
            editingItemId={editingId}
            onAdded={clearDraft}
            productCode={catalog.product.code}
            configuration={{
              selection: currentQuote.selection,
              quantity: state.quantity,
              ...(size.code === CUSTOM_SIZE_VALUE ? { customSize: state.customSize } : {}),
            }}
            logoDataUrl={mode === 'template' && template ? (design.values[logoFieldKey(template) ?? ''] || null) : null}
            prepareDesign={(logoKey) =>
              mode === 'template'
                ? prepareTemplateDesign(template, design.values, logoKey)
                : prepareUploadDesign(pdf.files, pdfSources.checks)
            }
          />
        </div>
      </section>

      <section className={styles.previewColumn} aria-label="Card preview">
        <CardPreview
          fill
          catalog={catalog}
          selection={state.selection}
          size={size}
          artwork={previewImages}
        />
      </section>

      <section className={`${styles.column} ${styles.designColumn}`} aria-label="Design">
        <div className={styles.columnBody}>
          <h2 className={styles.columnTitle}>Your design</h2>
          <div className={designStyles.modeSwitch} role="group" aria-label="How do you want to design?">
            <button
              type="button"
              className={designStyles.modeButton}
              aria-pressed={mode === 'template'}
              onClick={() => setMode('template')}
            >
              Use a template
            </button>
            <button
              type="button"
              className={designStyles.modeButton}
              aria-pressed={mode === 'upload'}
              onClick={() => setMode('upload')}
            >
              Upload your design
            </button>
          </div>
          {mode === 'template' ? (
            <>
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
            </>
          ) : (
            <UploadPanel
              files={pdf.files}
              checks={pdfSources.checks}
              backMode={backMode}
              size={expectedSize}
              onAdd={(side, file) => void pdf.addFile(side, file)}
              onRemove={pdf.removeFile}
            />
          )}
        </div>
      </section>
    </div>
  );
}
