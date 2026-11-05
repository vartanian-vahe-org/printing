import { SIZE_GROUP } from './constants.js';
import type { Catalog, SizeAttributes } from './types.js';

/** Size facts needed for preview and print files. */
export interface ResolvedSize {
  code: string;
  widthIn: number;
  heightIn: number;
  bleedIn: number;
  safeIn: number;
}

export function resolveSize(catalog: Catalog, sizeCode: string): ResolvedSize {
  const group = catalog.groups.find((g) => g.code === SIZE_GROUP);
  if (!group) throw new Error(`Catalog has no "${SIZE_GROUP}" option group`);
  const value = group.values.find((v) => v.code === sizeCode);
  if (!value) throw new Error(`Unknown size "${sizeCode}"`);
  const a = value.attributes as unknown as SizeAttributes;
  return { code: sizeCode, widthIn: a.trim_w_in, heightIn: a.trim_h_in, bleedIn: a.bleed_in, safeIn: a.safe_in };
}
