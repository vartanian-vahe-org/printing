/**
 * Pure helpers for the 3D card preview (no three.js imports, so they are unit-testable).
 * Scene units are inches.
 */
import type { Catalog, ResolvedSize, Selection } from '@printing/pricing';

/** Surface finish names stored in coating attributes (front/back). */
export type Finish = 'matte' | 'gloss' | 'uv' | 'soft_touch' | 'silk' | 'none';

export type BackMode = 'separate' | 'blank' | 'same_as_front';

export interface CardSpec {
  widthIn: number;
  heightIn: number;
  /** Real paper thickness in inches (1pt = 0.001"). */
  thicknessIn: number;
  /** Corner radius, already clamped to fit the card. */
  radiusIn: number;
  frontFinish: Finish;
  backFinish: Finish;
  backMode: BackMode;
}

/** Real cards are ~0.014" thick; scale the edge so it reads on screen when the card turns. */
export const THICKNESS_EXAGGERATION = 2.5;

const FINISHES: readonly Finish[] = ['matte', 'gloss', 'uv', 'soft_touch', 'silk', 'none'];
const BACK_MODES: readonly BackMode[] = ['separate', 'blank', 'same_as_front'];

function attributes(catalog: Catalog, group: string, value: string | undefined): Record<string, unknown> {
  return catalog.groups.find((g) => g.code === group)?.values.find((v) => v.code === value)?.attributes ?? {};
}

function asFinish(value: unknown): Finish {
  return FINISHES.includes(value as Finish) ? (value as Finish) : 'matte';
}

export function cardSpec(catalog: Catalog, selection: Selection, size: ResolvedSize): CardSpec {
  const paper = attributes(catalog, 'paper', selection.paper);
  const coating = attributes(catalog, 'coating', selection.coating);
  const corners = attributes(catalog, 'corners', selection.corners);
  const sides = attributes(catalog, 'printed_side', selection.printed_side);

  const thicknessPt = Number(paper.thickness_pt ?? 14);
  const radius = Math.max(0, Number(corners.radius_in ?? 0));
  const backMode = BACK_MODES.includes(sides.back as BackMode) ? (sides.back as BackMode) : 'separate';

  return {
    widthIn: size.widthIn,
    heightIn: size.heightIn,
    thicknessIn: thicknessPt / 1000,
    radiusIn: Math.min(radius, Math.min(size.widthIn, size.heightIn) / 2),
    frontFinish: asFinish(coating.front),
    // Blank back: UV is not applied to an unprinted side (spec §3.1, GotPrint rule).
    backFinish: backMode === 'blank' && coating.back === 'uv' ? 'none' : asFinish(coating.back),
    backMode,
  };
}

/** Physically based material settings per finish (tuned by eye, see docs/plan/phase-1.md §6). */
export interface FinishMaterial {
  roughness: number;
  clearcoat: number;
  clearcoatRoughness: number;
  sheen: number;
  sheenRoughness: number;
  /** Paper tint multiplied into the artwork. */
  color: string;
  /** Adds a fine paper-grain bump. */
  paperGrain: boolean;
  /** How strongly the studio lights reflect (shiny finishes catch a visible light streak). */
  envMapIntensity: number;
}

export function finishMaterial(finish: Finish): FinishMaterial {
  const base = {
    clearcoat: 0,
    clearcoatRoughness: 0,
    sheen: 0,
    sheenRoughness: 0,
    color: '#ffffff',
    paperGrain: false,
    envMapIntensity: 0.7,
  };
  switch (finish) {
    case 'gloss':
      return { ...base, roughness: 0.28, clearcoat: 0.5, clearcoatRoughness: 0.18, envMapIntensity: 1.1 };
    case 'uv':
      return { ...base, roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 1.5 };
    case 'silk':
      return { ...base, roughness: 0.45, clearcoat: 0.25, clearcoatRoughness: 0.35, envMapIntensity: 0.9 };
    case 'soft_touch':
      return { ...base, roughness: 1, sheen: 0.6, sheenRoughness: 0.9, envMapIntensity: 0.45 };
    case 'none':
      return { ...base, roughness: 0.95, color: '#fbf8f1', paperGrain: true, envMapIntensity: 0.5 };
    case 'matte':
    default:
      return { ...base, roughness: 0.82 };
  }
}

/** Distance that frames the card nicely for a vertical field of view (degrees) and aspect. */
export function cameraDistance(spec: Pick<CardSpec, 'widthIn' | 'heightIn'>, fovDeg: number, aspect: number): number {
  const margin = 1.45;
  const halfFov = (fovDeg * Math.PI) / 360;
  const byHeight = (spec.heightIn * margin) / 2 / Math.tan(halfFov);
  const byWidth = (spec.widthIn * margin) / 2 / Math.tan(halfFov) / Math.max(aspect, 0.01);
  return Math.max(byHeight, byWidth);
}

/** Maps a point on the card face (centered, inches) to texture UV (0..1). */
export function faceUv(x: number, y: number, widthIn: number, heightIn: number): [number, number] {
  return [x / widthIn + 0.5, y / heightIn + 0.5];
}

export function finishLabel(finish: Finish): string {
  return { matte: 'Matte', gloss: 'Gloss', uv: 'High Gloss UV', soft_touch: 'Soft Touch', silk: 'Silk', none: 'Uncoated' }[
    finish
  ];
}
