/**
 * Template design state for the homepage: which template, what the customer typed,
 * and the laid-out artwork (scenes) for both sides of the card.
 */
import type { ResolvedSize } from '@printing/pricing';
import { fieldsFor, layoutFace, type FaceScene, type MeasureText, type RenderWarning, type Template } from '@printing/templates';
import type { BackMode } from './card3d';

export interface DesignState {
  templateCode: string | null;
  /** Kept across template switches so the customer never retypes. */
  values: Record<string, string>;
}

export function templatesForSize(templates: Template[], sizeCode: string): Template[] {
  return templates.filter((t) => t.supportedSizeCodes.includes(sizeCode));
}

export function initialDesign(templates: Template[], sizeCode: string): DesignState {
  return { templateCode: templatesForSize(templates, sizeCode)[0]?.code ?? null, values: {} };
}

/**
 * Keeps the chosen template valid for the selected size. Returns the template that was
 * replaced (to tell the customer) or null when nothing changed.
 */
export function ensureTemplateForSize(
  templates: Template[],
  design: DesignState,
  sizeCode: string,
): { design: DesignState; replaced: Template | null } {
  const available = templatesForSize(templates, sizeCode);
  if (available.some((t) => t.code === design.templateCode)) return { design, replaced: null };
  const replaced = templates.find((t) => t.code === design.templateCode) ?? null;
  return { design: { ...design, templateCode: available[0]?.code ?? null }, replaced };
}

export interface Artwork {
  front: FaceScene;
  /** null when the back is blank or repeats the front (the 3D card handles both). */
  back: FaceScene | null;
  warnings: RenderWarning[];
}

export function layoutArtwork(
  template: Template,
  values: Record<string, string>,
  size: ResolvedSize,
  backMode: BackMode,
  measure?: MeasureText,
): Artwork {
  const geometry = { widthIn: size.widthIn, heightIn: size.heightIn, bleedIn: size.bleedIn, safeIn: size.safeIn };
  const front = layoutFace({ layout: template.layout, side: 'front', values, geometry, measure });
  const back = backMode === 'separate' ? layoutFace({ layout: template.layout, side: 'back', values, geometry, measure }) : null;
  const warnings = [...front.warnings, ...(back?.warnings ?? [])];
  // One warning per field is enough for the form.
  const unique = warnings.filter((w, i) => warnings.findIndex((o) => o.field === w.field) === i);
  return { front, back, warnings: unique };
}

export function visibleFields(template: Template, backMode: BackMode) {
  return fieldsFor(template.layout, backMode);
}
