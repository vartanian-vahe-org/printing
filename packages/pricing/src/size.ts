import { CUSTOM_SIZE_VALUE, SIZE_GROUP } from './constants.js';
import type {
  Catalog,
  CustomSize,
  CustomSizeAttributes,
  OptionValue,
  PresetSizeAttributes,
} from './types.js';

/** Size facts needed for pricing, preview and print files. */
export interface ResolvedSize {
  /** Size value code to store on the selection (a preset when custom dimensions match one exactly). */
  code: string;
  widthIn: number;
  heightIn: number;
  bleedIn: number;
  safeIn: number;
  priceMultiplier: number;
  /** Preset whose price applies (same dimensions in either orientation), if any. */
  pricedAsCode: string | null;
}

export class InvalidCustomSizeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidCustomSizeError';
  }
}

const EPSILON = 1e-9;

function sizeValues(catalog: Catalog): OptionValue[] {
  const group = catalog.groups.find((g) => g.code === SIZE_GROUP);
  if (!group) throw new Error(`Catalog has no "${SIZE_GROUP}" option group`);
  return group.values;
}

function presetOf(value: OptionValue): PresetSizeAttributes {
  return value.attributes as unknown as PresetSizeAttributes;
}

function sameDimensions(a: [number, number], b: [number, number]): boolean {
  return Math.abs(a[0] - b[0]) < EPSILON && Math.abs(a[1] - b[1]) < EPSILON;
}

function isOnStep(value: number, min: number, step: number): boolean {
  const steps = (value - min) / step;
  return Math.abs(steps - Math.round(steps)) < 1e-6;
}

/** Throws InvalidCustomSizeError when width/height are outside the allowed range or step. */
export function validateCustomSize(attributes: CustomSizeAttributes, size: CustomSize): void {
  const { min_in: min, max_in: max, step_in: step } = attributes;
  for (const [name, value] of [
    ['Width', size.widthIn],
    ['Height', size.heightIn],
  ] as const) {
    if (!Number.isFinite(value)) throw new InvalidCustomSizeError(`${name} must be a number`);
    if (value < min - EPSILON || value > max + EPSILON) {
      throw new InvalidCustomSizeError(`${name} must be between ${min}" and ${max}"`);
    }
    if (!isOnStep(value, min, step)) {
      throw new InvalidCustomSizeError(`${name} must be in ${step}" steps`);
    }
  }
}

/**
 * Custom size price multiplier (clone of UPrinting, spec §4.3), orientation-agnostic:
 *   fits inside fit_box  -> fit_multiplier
 *   otherwise            -> max(fit_multiplier, W x H x area_multiplier)
 */
export function customSizeMultiplier(attributes: CustomSizeAttributes, size: CustomSize): number {
  const [short, long] = [size.widthIn, size.heightIn].sort((a, b) => a - b) as [number, number];
  const [boxShort, boxLong] = [attributes.fit_box.w_in, attributes.fit_box.h_in].sort((a, b) => a - b) as [
    number,
    number,
  ];
  if (short <= boxShort + EPSILON && long <= boxLong + EPSILON) return attributes.fit_multiplier;
  const byArea = size.widthIn * size.heightIn * attributes.area_multiplier;
  // Round away float noise (3 x 3 x 0.283 = 2.5469999...) so stored/displayed multipliers stay clean.
  return Math.max(attributes.fit_multiplier, Math.round(byArea * 1e6) / 1e6);
}

/**
 * Resolves the selected size into dimensions and a price multiplier.
 * Custom dimensions that exactly match a preset switch to that preset (as UPrinting does);
 * the same preset rotated keeps the custom code (orientation matters for the design)
 * but is priced like the preset.
 */
export function resolveSize(catalog: Catalog, sizeCode: string, customSize?: CustomSize): ResolvedSize {
  const values = sizeValues(catalog);
  const value = values.find((v) => v.code === sizeCode);
  if (!value) throw new Error(`Unknown size "${sizeCode}"`);

  if (sizeCode !== CUSTOM_SIZE_VALUE) {
    const a = presetOf(value);
    return {
      code: sizeCode,
      widthIn: a.trim_w_in,
      heightIn: a.trim_h_in,
      bleedIn: a.bleed_in,
      safeIn: a.safe_in,
      priceMultiplier: a.price_multiplier,
      pricedAsCode: sizeCode,
    };
  }

  if (!customSize) throw new InvalidCustomSizeError('Width and height are required for a custom size');
  const attrs = value.attributes as unknown as CustomSizeAttributes;
  validateCustomSize(attrs, customSize);

  const dims: [number, number] = [customSize.widthIn, customSize.heightIn];
  const presets = values.filter((v) => v.code !== CUSTOM_SIZE_VALUE);
  const exact = presets.find((v) => sameDimensions(dims, [presetOf(v).trim_w_in, presetOf(v).trim_h_in]));
  if (exact) return resolveSize(catalog, exact.code);

  const rotated = presets.find((v) => sameDimensions(dims, [presetOf(v).trim_h_in, presetOf(v).trim_w_in]));
  return {
    code: CUSTOM_SIZE_VALUE,
    widthIn: customSize.widthIn,
    heightIn: customSize.heightIn,
    bleedIn: attrs.bleed_in,
    safeIn: attrs.safe_in,
    priceMultiplier: rotated ? presetOf(rotated).price_multiplier : customSizeMultiplier(attrs, customSize),
    pricedAsCode: rotated?.code ?? null,
  };
}
