/**
 * Catalog data as served by the API (GET /products/:code/configurator).
 * Everything is identified by stable `code`s, never database ids.
 */
export interface Catalog {
  product: { code: string; name: string };
  groups: OptionGroup[];
  rules: OptionRule[];
  quantityTiers: QuantityTier[];
  /** Upcharge per option value per quantity. Missing entries mean 0. */
  upcharges: Upcharge[];
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
  basePriceCents: number;
  sortOrder: number;
  isDefault: boolean;
}

export interface Upcharge {
  group: string;
  value: string;
  quantity: number;
  upchargeCents: number;
}

/** Selected value code per group code, e.g. { paper: '14pt', coating: 'matte_both' }. */
export type Selection = Record<string, string>;

export interface CustomSize {
  widthIn: number;
  heightIn: number;
}

export interface Configuration {
  selection: Selection;
  quantity: number;
  /** Required when selection.size is the custom size value. */
  customSize?: CustomSize;
}

/** Size attributes stored on option values of the `size` group. */
export interface PresetSizeAttributes {
  trim_w_in: number;
  trim_h_in: number;
  bleed_in: number;
  safe_in: number;
  price_multiplier: number;
}

export interface CustomSizeAttributes {
  min_in: number;
  max_in: number;
  step_in: number;
  bleed_in: number;
  safe_in: number;
  fit_box: { w_in: number; h_in: number };
  fit_multiplier: number;
  area_multiplier: number;
}
