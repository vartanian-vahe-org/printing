/**
 * Unsaved business card design kept in this browser (open issue U7): options, step, template, text,
 * logo and the brief for our designer survive a reload until the card goes into the cart. Best
 * effort: storage can be blocked or full, and a large logo is left out rather than losing the rest.
 */
import type { BriefState } from './cart-design';
import type { ConfiguratorState } from './configurator-state';
import type { DesignState } from './design-state';

/** One draft per product: options and templates of one product mean nothing on another. */
const key = (productCode: string) => `business-card-draft-v1:${productCode}`;
/** Data URLs above this are not stored (localStorage holds about 5 MB per site). */
const MAX_LOGO_CHARS = 1_000_000;

export interface Draft {
  state: ConfiguratorState;
  design: DesignState;
  mode: 'template' | 'upload' | 'service';
  /** Where the customer was (drafts from before the step layout have none). */
  step?: 'options' | 'design' | 'details';
  tierCode?: string | null;
  brief?: BriefState;
}

export function loadDraft(productCode: string): Draft | null {
  try {
    const raw = localStorage.getItem(key(productCode));
    if (!raw) return null;
    const draft = JSON.parse(raw) as Draft;
    return draft?.state?.selection && draft.design && draft.mode ? draft : null;
  } catch {
    return null;
  }
}

export function saveDraft(productCode: string, draft: Draft): void {
  const values = Object.fromEntries(
    Object.entries(draft.design.values).filter(([, v]) => !(v.startsWith('data:') && v.length > MAX_LOGO_CHARS)),
  );
  try {
    // Files still uploading or failed would not come back after a reload.
    const brief = draft.brief ? { ...draft.brief, files: draft.brief.files.filter((f) => f.status === 'done') } : undefined;
    localStorage.setItem(key(productCode), JSON.stringify({ ...draft, design: { ...draft.design, values }, brief }));
  } catch {
    // Storage full or blocked: the design just won't survive a reload.
  }
}

export function clearDraft(productCode: string): void {
  try {
    localStorage.removeItem(key(productCode));
  } catch {
    // Nothing to clear.
  }
}
