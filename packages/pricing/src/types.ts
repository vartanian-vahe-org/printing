/**
 * Catalog data as served by the API (GET /products/:code/configurator).
 * Everything is identified by stable `code`s, never database ids.
 */
export interface Catalog {
  /** unitName / unitNamePlural: what customers call it, e.g. "flyer" and "flyers". */
  product: { code: string; name: string; unitName: string; unitNamePlural: string };
  groups: OptionGroup[];
  rules: OptionRule[];
  quantityTiers: QuantityTier[];
  /** Set price of each core combination (size, paper, printed sides) per quantity. A missing one is not sold. */
  corePrices: CorePrice[];
  /** Quantity × speed table of the turnaround group. A missing pair means that speed is not offered at that quantity. */
  turnarounds: TurnaroundOption[];
}

export interface OptionGroup {
  code: string;
  label: string;
  sortOrder: number;
  displayStyle: 'dropdown' | 'radio' | 'swatch';
  values: OptionValue[];
}

export interface OptionValue {
  code: string;
  label: string;
  description: string | null;
  sortOrder: number;
  isDefault: boolean;
  attributes: Record<string, unknown>;
  /** Add-ons: percent of the core price added when picked; negative for a discount. 0 for other groups. */
  addonPercent: number;
}

/** When `whenGroup` = `whenValue`, `targetGroup` may only use `allowed` values. */
export interface OptionRule {
  whenGroup: string;
  whenValue: string;
  targetGroup: string;
  allowed: string[];
}

export interface QuantityTier {
  quantity: number;
  sortOrder: number;
  isDefault: boolean;
}

export interface CorePrice {
  size: string;
  paper: string;
  printedSide: string;
  quantity: number;
  priceCents: number;
}

export interface TurnaroundOption {
  /** Turnaround value code, e.g. 'rush'. */
  value: string;
  quantity: number;
  /** Production days at this quantity. */
  businessDays: number;
  /** Added to the printing price (core price and add-ons) in percent; negative for a discount. */
  percent: number;
}

/** Selected value code per group code, e.g. { paper: '14pt', coating: 'matte_both' }. */
export type Selection = Record<string, string>;

export interface Configuration {
  selection: Selection;
  quantity: number;
}

/** Size attributes stored on option values of the `size` group. */
export interface SizeAttributes {
  trim_w_in: number;
  trim_h_in: number;
  bleed_in: number;
  safe_in: number;
}
