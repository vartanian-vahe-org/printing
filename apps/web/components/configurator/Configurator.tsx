'use client';

import {
  CUSTOM_SIZE_VALUE,
  getAllowedValues,
  resolveSelection,
  SIZE_GROUP,
  sortedGroups,
  TURNAROUND_GROUP,
  turnaroundDays,
  type Catalog,
  type ProductionCalendar,
  type Selection,
} from '@printing/pricing';
import { layoutFace, type DesignServiceTier, type MeasureText, type Template, type TemplateFacet } from '@printing/templates';
import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { canvasMeasure } from '../../lib/browser-measure';
import { cardSpec } from '../../lib/card3d';
import {
  EMPTY_BRIEF,
  logoFieldKey,
  prepareServiceDesign,
  prepareTemplateDesign,
  prepareUploadDesign,
  type BriefState,
} from '../../lib/cart-design';
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
import { clearDraft, loadDraft, saveDraft } from '../../lib/design-draft';
import {
  ensureTemplateForSize,
  initialDesign,
  layoutArtwork,
  templatesForSize,
  visibleFields,
  type DesignState,
} from '../../lib/design-state';
import { editingItemId, loadItemToEdit } from '../../lib/edit-cart-item';
import { isEnabled } from '../../lib/features';
import { loadTemplateFonts } from '../../lib/template-fonts';
import { useArtworkSources, usePageImage, usePdfFiles } from '../../lib/use-pdf-artwork';
import { useScenePngs } from '../../lib/use-scene-png';
import { BriefForm } from '../design/BriefForm';
import { DesignPanel } from '../design/DesignPanel';
import { MethodPicker, type DesignMethod } from '../design/MethodPicker';
import { ServiceTiers } from '../design/ServiceTiers';
import { TemplateBrowser } from '../design/TemplateBrowser';
import { UploadPanel } from '../design/UploadPanel';
import { CardPreview } from '../preview/CardPreview';
import { AddToCart } from './AddToCart';
import { DesignReview } from './DesignReview';
import { ProofChoice } from './ProofChoice';
import type { UploadProof } from '../../lib/cart';
import styles from './configurator.module.css';
import { CustomSizeInputs } from './CustomSizeInputs';
import { OptionSelect } from './OptionSelect';
import { PriceSummary } from './PriceSummary';
import { QuantitySelect } from './QuantitySelect';
import { ShipEstimate } from './ShipEstimate';

/** 300 pixels per inch for the 3D card textures; template list thumbnails need far less. */
const TEXTURE_PX_PER_PT = 300 / 72;
const THUMBNAIL_PX_PER_PT = 1.6;

/** 1. options and price · 2. how to design · 3. personalize (or upload, or brief the designer). */
type Step = 'options' | 'design' | 'details';

const STEPS: { step: Step; label: string }[] = [
  { step: 'options', label: 'Options' },
  { step: 'design', label: 'Design' },
  { step: 'details', label: 'Details' },
];

const DETAILS_TITLE: Record<DesignMethod, string> = {
  template: 'Personalize your card',
  upload: 'Check your files',
  service: 'Tell our designer what you need',
};

interface Props {
  catalog: Catalog;
  defaults: { selection: Selection; quantity: number };
  calendar: ProductionCalendar;
  templates: Template[];
  facets: TemplateFacet[];
  designServices: DesignServiceTier[];
}

export function Configurator({ catalog, defaults, calendar, templates, facets, designServices }: Props) {
  const [state, setState] = useState(() => initialState(catalog, defaults));
  const [autoChanges, setAutoChanges] = useState<AutoChange[]>([]);
  const [design, setDesign] = useState<DesignState>(() => initialDesign(templates, state.selection[SIZE_GROUP] ?? ''));
  const [designNotice, setDesignNotice] = useState<string | null>(null);
  const [step, setStep] = useState<Step>('options');
  /** How the design is made; null until the customer picks in step 2. */
  const [method, setMethod] = useState<DesignMethod | null>(null);
  const [tierCode, setTierCode] = useState<string | null>(null);
  const [brief, setBrief] = useState<BriefState>(EMPTY_BRIEF);
  /** Template: the customer approved the preview (needed to add to the cart). Any change asks again. */
  const [reviewed, setReviewed] = useState(false);
  useEffect(() => setReviewed(false), [design, state]);
  /** Upload: a proof after ordering, or print right away. */
  const [uploadProof, setUploadProof] = useState<UploadProof>('send');
  const pdf = usePdfFiles();
  /** Cart item being edited (/business-cards?edit=<id>), saved back instead of added. */
  const [editingId, setEditingId] = useState<string | null>(null);

  // Unsaved design from an earlier visit (U7); saved as the customer works, cleared once in the cart.
  const [draftReady, setDraftReady] = useState(false);
  useEffect(() => {
    if (editingItemId()) return;
    const draft = loadDraft();
    if (draft && (!draft.design.templateCode || templates.some((t) => t.code === draft.design.templateCode))) {
      setState({ ...draft.state, selection: resolveSelection(catalog, draft.state.selection) });
      setDesign(draft.design);
      const draftMethod = draft.step ? draft.mode : null;
      setMethod(draftMethod);
      setTierCode(draft.tierCode && designServices.some((t) => t.code === draft.tierCode) ? draft.tierCode : null);
      if (draft.brief) setBrief(draft.brief);
      // Picked PDFs are not kept across reloads: back to choosing them.
      setStep(draft.step === 'details' && draftMethod === 'upload' ? 'design' : (draft.step ?? 'options'));
    }
    setDraftReady(true);
  }, [catalog, templates, designServices]);
  useEffect(() => {
    if (!draftReady || editingId) return;
    const timer = setTimeout(() => saveDraft({ state, design, mode: method ?? 'template', step, tierCode, brief }), 400);
    return () => clearTimeout(timer);
  }, [draftReady, editingId, state, design, method, step, tierCode, brief]);

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
        const itemDesign = item.design;
        if (itemDesign.mode === 'template') {
          const editedTemplate = templates.find((t) => t.code === itemDesign.templateCode);
          const logoKey = editedTemplate ? logoFieldKey(editedTemplate) : null;
          setMethod('template');
          setDesign({
            templateCode: itemDesign.templateCode,
            values: { ...itemDesign.values, ...(logoKey && logoDataUrl ? { [logoKey]: logoDataUrl } : {}) },
          });
        } else if (itemDesign.mode === 'service') {
          setMethod('service');
          setTierCode(itemDesign.tierCode);
          setBrief({
            content: itemDesign.brief.content,
            notes: itemDesign.brief.notes,
            files: itemDesign.brief.files.map((f) => ({ id: f.key, fileName: f.fileName, status: 'done', key: f.key })),
          });
        } else {
          setMethod('upload');
          setUploadProof(itemDesign.proof ?? 'send');
          if (files.front) void pdf.addFile('front', files.front);
          if (files.back) void pdf.addFile('back', files.back);
        }
        setStep('details');
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
  const optionGroups = groups.filter((g) => g.code !== TURNAROUND_GROUP);
  const turnaroundGroup = groups.find((g) => g.code === TURNAROUND_GROUP) ?? null;
  const allowed = useMemo(() => getAllowedValues(catalog, state.selection), [catalog, state.selection]);
  const currentQuote = useMemo(() => priceOf(catalog, state), [catalog, state]);
  const deltas = useMemo(() => optionDeltas(catalog, state, allowed), [catalog, state, allowed]);
  const tiers = useMemo(() => tierPrices(catalog, state), [catalog, state]);
  const customAttrs = useMemo(() => customSizeAttributes(catalog), [catalog]);

  const size = currentQuote.size;
  const backMode = useMemo(() => cardSpec(catalog, state.selection, size).backMode, [catalog, state.selection, size]);
  const availableTemplates = useMemo(() => templatesForSize(templates, size.code), [templates, size.code]);
  const template = availableTemplates.find((t) => t.code === design.templateCode) ?? null;
  const tier = designServices.find((t) => t.code === tierCode) ?? null;
  const designFee = method === 'service' && tier ? { name: tier.name, priceCents: tier.priceCents } : null;
  const printDays = turnaroundDays(catalog, currentQuote.selection);
  const shipDays = printDays === null ? null : printDays + (designFee && tier ? tier.designDays : 0);

  // Typing stays responsive; the artwork re-renders right after.
  const values = useDeferredValue(design.values);
  const artwork = useMemo(
    () => (template ? layoutArtwork(template, values, size, backMode, measure) : null),
    [template, values, size, backMode, measure],
  );
  const artworkScenes = useMemo(() => ({ front: artwork?.front ?? null, back: artwork?.back ?? null }), [artwork]);
  const artworkImages = useScenePngs(artworkScenes, TEXTURE_PX_PER_PT);
  // Template list thumbnails show the customer's own text once typed.
  const thumbnailScenes = useMemo(() => {
    if (step !== 'design') return {};
    const geometry = { widthIn: size.widthIn, heightIn: size.heightIn, bleedIn: size.bleedIn, safeIn: size.safeIn };
    return Object.fromEntries(availableTemplates.map((t) => [t.code, layoutFace({ layout: t.layout, side: 'front', values, geometry, measure })]));
  }, [step, availableTemplates, values, size, measure]);
  const thumbnails = useScenePngs(thumbnailScenes, THUMBNAIL_PX_PER_PT);

  const expectedSize = useMemo(
    () => ({ widthIn: size.widthIn, heightIn: size.heightIn, bleedIn: size.bleedIn }),
    [size.widthIn, size.heightIn, size.bleedIn],
  );
  const pdfSources = useArtworkSources(pdf.files, expectedSize, backMode);
  const pdfFront = usePageImage(method === 'upload' ? pdfSources.front : null);
  const pdfBack = usePageImage(method === 'upload' ? pdfSources.back : null);

  // The designer's card does not exist yet: a blank card in the chosen paper and finish.
  const previewImages =
    method === 'upload'
      ? { front: pdfFront, back: pdfBack }
      : method === 'service'
        ? undefined
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

  function go(next: Step) {
    setStep(next);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  const uploadReady = pdf.files.front?.status === 'ready';
  const reachable: Record<Step, boolean> = {
    options: true,
    design: true,
    details: method === 'template' ? Boolean(template) : method === 'service' ? Boolean(tier) : method === 'upload' ? uploadReady : false,
  };

  const preview = (
    <section className={styles.previewColumn} aria-label="Card preview">
      <CardPreview fill catalog={catalog} selection={state.selection} size={size} artwork={previewImages} blank={method === 'service' && step === 'details'} />
    </section>
  );

  const priceAndDate = (
    <>
      <PriceSummary quote={currentQuote} designFee={step === 'details' ? designFee : null} />
      <ShipEstimate calendar={calendar} businessDays={step === 'details' ? shipDays : printDays} />
    </>
  );

  return (
    <div className={styles.configurator}>
      <nav aria-label="Steps">
        <ol className={styles.steps}>
          {STEPS.map(({ step: s, label }, index) => (
            <li key={s}>
              <button
                type="button"
                className={styles.stepButton}
                aria-current={step === s ? 'step' : undefined}
                disabled={!reachable[s]}
                onClick={() => go(s)}
              >
                <span className={styles.stepNumber}>{index + 1}</span>
                {label}
              </button>
            </li>
          ))}
        </ol>
      </nav>

      {step === 'options' && (
        <div className={styles.studio}>
          {preview}

          <section className={`${styles.column} ${styles.mainColumn}`} aria-label="Card options">
            <div className={styles.columnBody}>
              <h2 className={styles.columnTitle}>Options</h2>
              {optionGroups.map((group) => (
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
              <AutoChangeNotice catalog={catalog} changes={autoChanges} />
            </div>
          </section>

          <section className={`${styles.column} ${styles.orderColumn}`} aria-label="Quantity and turnaround">
            <div className={styles.columnBody}>
              <div className={styles.field}>
                <QuantitySelect tiers={tiers} value={state.quantity} onChange={(quantity) => apply(changeQuantity(state, quantity), [])} />
              </div>
              {turnaroundGroup && (
                <div className={styles.field}>
                  <OptionSelect
                    group={turnaroundGroup}
                    allowed={allowed[TURNAROUND_GROUP] ?? []}
                    value={state.selection[TURNAROUND_GROUP] ?? ''}
                    deltas={deltas[TURNAROUND_GROUP] ?? {}}
                    onChange={(value) => {
                      const result = changeOption(catalog, state, TURNAROUND_GROUP, value);
                      apply(result.state, result.autoChanges);
                    }}
                  />
                </div>
              )}
            </div>
            <div className={styles.priceDock}>
              {priceAndDate}
              <button type="button" className={styles.primaryButton} onClick={() => go('design')}>
                Continue
              </button>
            </div>
          </section>
        </div>
      )}

      {step === 'design' && (
        <div className={styles.choose}>
          <div className={styles.chooseHeader}>
            <h2>How would you like to design your card?</h2>
            <button type="button" className={styles.backButton} onClick={() => go('options')}>
              ← Back to options
            </button>
          </div>

          <MethodPicker
            value={method}
            templateCount={availableTemplates.length}
            servicePriceFrom={designServices.length ? Math.min(...designServices.map((t) => t.priceCents)) : null}
            onChange={setMethod}
          />

          {method === 'upload' && (
            <section className={styles.uploadStep} aria-label="Upload your files">
              <UploadPanel
                files={pdf.files}
                checks={pdfSources.checks}
                backMode={backMode}
                size={expectedSize}
                onAdd={(side, file) => void pdf.addFile(side, file)}
                onRemove={pdf.removeFile}
              />
              <div className={styles.uploadNext}>
                <p className={styles.hint}>We check your files right away and show your card in 3D on the next step.</p>
                <button type="button" className={styles.primaryButton} disabled={!uploadReady} onClick={() => go('details')}>
                  Review your card
                </button>
              </div>
            </section>
          )}

          {method === 'template' && (
            <TemplateBrowser
              templates={availableTemplates}
              facets={facets}
              selectedCode={design.templateCode}
              thumbnails={thumbnails}
              onSelect={(code) => {
                setDesign((d) => ({ ...d, templateCode: code }));
                setDesignNotice(null);
                go('details');
              }}
            />
          )}

          {method === 'service' && (
            <ServiceTiers
              tiers={designServices}
              selectedCode={tierCode}
              onSelect={(code) => {
                setTierCode(code);
                go('details');
              }}
            />
          )}
        </div>
      )}

      {step === 'details' && method && (
        <div className={styles.studio}>
          {preview}

          <section className={`${styles.column} ${styles.mainColumn}`} aria-label={DETAILS_TITLE[method]}>
            <div className={styles.columnBody}>
              <h2 className={styles.columnTitle}>{DETAILS_TITLE[method]}</h2>
              {method === 'template' && (
                <DesignPanel
                  selected={template}
                  fields={template ? visibleFields(template, backMode) : []}
                  values={design.values}
                  warnings={artwork?.warnings ?? []}
                  notice={designNotice}
                  onChangeTemplate={() => go('design')}
                  onChangeValue={(key, value) => setDesign((d) => ({ ...d, values: { ...d.values, [key]: value } }))}
                />
              )}
              {method === 'upload' && (
                <UploadPanel
                  files={pdf.files}
                  checks={pdfSources.checks}
                  backMode={backMode}
                  size={expectedSize}
                  onAdd={(side, file) => void pdf.addFile(side, file)}
                  onRemove={pdf.removeFile}
                />
              )}
              {method === 'service' && <BriefForm tier={tier} brief={brief} onChange={setBrief} onChangeTier={() => go('design')} />}
            </div>
          </section>

          <section className={`${styles.column} ${styles.orderColumn}`} aria-label="Your order">
            <div className={styles.columnBody}>
              <div className={styles.orderHeader}>
                <h2 className={styles.columnTitle}>Your cards</h2>
                <button type="button" className={styles.backButton} onClick={() => go('options')}>
                  Edit options
                </button>
              </div>
              <dl className={styles.optionList}>
                <div>
                  <dt>Quantity</dt>
                  <dd>{state.quantity.toLocaleString('en-US')}</dd>
                </div>
                {currentQuote.lines.map((line) => (
                  <div key={line.group}>
                    <dt>{line.groupLabel}</dt>
                    <dd>{line.valueLabel}</dd>
                  </div>
                ))}
              </dl>
              {isEnabled('cart') && method === 'template' && template && (
                <DesignReview
                  fields={visibleFields(template, backMode).filter((f) => f.type === 'text')}
                  values={design.values}
                  checked={reviewed}
                  onChange={setReviewed}
                />
              )}
              {isEnabled('cart') && method === 'upload' && <ProofChoice value={uploadProof} onChange={setUploadProof} />}
            </div>
            <div className={styles.priceDock}>
              {priceAndDate}
              {isEnabled('cart') && (
                <AddToCart
                  editingItemId={editingId}
                  onAdded={clearDraft}
                  productCode={catalog.product.code}
                  configuration={{
                    selection: currentQuote.selection,
                    quantity: state.quantity,
                    ...(size.code === CUSTOM_SIZE_VALUE ? { customSize: state.customSize } : {}),
                  }}
                  logoDataUrl={method === 'template' && template ? (design.values[logoFieldKey(template) ?? ''] || null) : null}
                  prepareDesign={(logoKey) =>
                    method === 'template'
                      ? prepareTemplateDesign(template, design.values, logoKey, reviewed)
                      : method === 'upload'
                        ? prepareUploadDesign(pdf.files, pdfSources.checks, uploadProof)
                        : prepareServiceDesign(tierCode, brief)
                  }
                />
              )}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

function AutoChangeNotice({ catalog, changes }: { catalog: Catalog; changes: AutoChange[] }) {
  return (
    <div aria-live="polite">
      {changes.length > 0 && (
        <div className={styles.notice}>
          {changes.map((change) => (
            <p key={change.group}>
              {groupLabel(catalog, change.group)} changed to <strong>{valueLabel(catalog, change.group, change.to)}</strong> to match your other
              choices.
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
