/**
 * Unsaved business card design kept in this browser (open issue U7): options, template, text and
 * logo survive a reload until the card goes into the cart. Best effort: storage can be blocked
 * or full, and a large logo is left out rather than losing the rest.
 */
import type { ConfiguratorState } from './configurator-state';
import type { DesignState } from './design-state';

const KEY = 'business-card-draft-v1';
/** Data URLs above this are not stored (localStorage holds about 5 MB per site). */
const MAX_LOGO_CHARS = 1_000_000;

export interface Draft {
  state: ConfiguratorState;
  design: DesignState;
  mode: 'template' | 'upload';
}

export function loadDraft(): Draft | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const draft = JSON.parse(raw) as Draft;
    return draft?.state?.selection && draft.design && draft.mode ? draft : null;
  } catch {
    return null;
  }
}

export function saveDraft(draft: Draft): void {
  const values = Object.fromEntries(
    Object.entries(draft.design.values).filter(([, v]) => !(v.startsWith('data:') && v.length > MAX_LOGO_CHARS)),
  );
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...draft, design: { ...draft.design, values } }));
  } catch {
    // Storage full or blocked: the design just won't survive a reload.
  }
}

export function clearDraft(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing to clear.
  }
}
