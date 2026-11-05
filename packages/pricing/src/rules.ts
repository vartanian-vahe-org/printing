import { PAPER_GROUP, PRINTED_SIDE_GROUP, SIZE_GROUP, TURNAROUND_GROUP } from './constants.js';
import type { Catalog, CorePrice, OptionGroup, Selection, TurnaroundOption } from './types.js';

/** Core groups in narrowing order, with the CorePrice field holding each one's value. */
const CORE_FIELDS = [
  [SIZE_GROUP, 'size'],
  [PAPER_GROUP, 'paper'],
  [PRINTED_SIDE_GROUP, 'printedSide'],
] as const satisfies readonly (readonly [string, keyof CorePrice])[];

export function sortedGroups(catalog: Catalog): OptionGroup[] {
  return [...catalog.groups].sort((a, b) => a.sortOrder - b.sortOrder);
}

function sortedValueCodes(group: OptionGroup): string[] {
  return [...group.values].sort((a, b) => a.sortOrder - b.sortOrder).map((v) => v.code);
}

/** Days and price of a turnaround speed at a quantity; undefined when that speed is not offered there. */
export function turnaroundAt(catalog: Catalog, value: string, quantity: number): TurnaroundOption | undefined {
  return catalog.turnarounds.find((t) => t.value === value && t.quantity === quantity);
}

/** Set price of the selected core options at a quantity; undefined when not sold there. */
export function corePriceAt(catalog: Catalog, selection: Selection, quantity: number): CorePrice | undefined {
  return catalog.corePrices.find(
    (p) => p.quantity === quantity && CORE_FIELDS.every(([group, field]) => p[field] === selection[group]),
  );
}

/** Quantities sold for the selected core options, in display order. */
export function offeredQuantities(catalog: Catalog, selection: Selection): number[] {
  return [...catalog.quantityTiers]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((t) => t.quantity)
    .filter((quantity) => corePriceAt(catalog, selection, quantity));
}

/** `quantity` when it is sold for these options, otherwise the next one up, otherwise the largest sold. */
export function nearestQuantity(catalog: Catalog, selection: Selection, quantity: number): number {
  const offered = offeredQuantities(catalog, selection);
  return offered.find((q) => q >= quantity) ?? offered.at(-1) ?? quantity;
}

/**
 * Values each group may use given the current selection of the OTHER groups, by the rules alone.
 * Rules triggered by the current selection restrict their target group; several rules on the same
 * group intersect. Result keeps the group's sort order.
 */
export function ruleAllowedValues(catalog: Catalog, selection: Selection): Record<string, string[]> {
  const allowed: Record<string, string[]> = {};
  for (const group of sortedGroups(catalog)) {
    let codes = sortedValueCodes(group);
    for (const rule of catalog.rules) {
      if (rule.targetGroup !== group.code || rule.whenGroup === group.code) continue;
      if (selection[rule.whenGroup] !== rule.whenValue) continue;
      const permitted = new Set(rule.allowed);
      codes = codes.filter((code) => permitted.has(code));
    }
    allowed[group.code] = codes;
  }
  return allowed;
}

/**
 * What the customer can pick: the rules, plus
 *  - each core group keeps the values with a price under the core options before it (size narrows
 *    paper, and both narrow printed sides, so picking a size is never undone by the paper);
 *  - turnaround keeps only the speeds offered at `quantity`.
 */
export function getAllowedValues(catalog: Catalog, selection: Selection, quantity: number): Record<string, string[]> {
  const allowed = ruleAllowedValues(catalog, selection);
  let priced = catalog.corePrices;
  for (const [group, field] of CORE_FIELDS) {
    const codes = allowed[group];
    if (codes) allowed[group] = codes.filter((code) => priced.some((p) => p[field] === code));
    priced = priced.filter((p) => p[field] === selection[group]);
  }
  const speeds = allowed[TURNAROUND_GROUP];
  if (speeds) allowed[TURNAROUND_GROUP] = speeds.filter((code) => turnaroundAt(catalog, code, quantity));
  return allowed;
}

export function defaultValue(group: OptionGroup): string | undefined {
  return group.values.find((v) => v.isDefault)?.code ?? sortedValueCodes(group)[0];
}

export class UnsatisfiableSelectionError extends Error {
  constructor(public readonly groupCode: string) {
    super(`No allowed value left for option group "${groupCode}". Check the option rules.`);
    this.name = 'UnsatisfiableSelectionError';
  }
}

/**
 * Turns any (partial or stale) selection into a valid one:
 *  - missing or unknown values get the group default;
 *  - values hidden by rules (or a turnaround not offered at `quantity`) are replaced by the group
 *    default if allowed, otherwise by the first allowed value in sort order.
 * Changes can cascade (paper -> coating -> turnaround), so it repeats until stable.
 */
export function resolveSelection(catalog: Catalog, input: Selection, quantity: number): Selection {
  const groups = sortedGroups(catalog);
  const selection: Selection = {};
  for (const group of groups) {
    const requested = input[group.code];
    const known = group.values.some((v) => v.code === requested);
    const fallback = defaultValue(group);
    if (known && requested) selection[group.code] = requested;
    else if (fallback) selection[group.code] = fallback;
  }

  const maxPasses = groups.length + 1;
  for (let pass = 0; pass < maxPasses; pass++) {
    let changed = false;
    for (const group of groups) {
      const allowed = getAllowedValues(catalog, selection, quantity)[group.code] ?? [];
      if (allowed.length === 0) throw new UnsatisfiableSelectionError(group.code);
      const current = selection[group.code];
      if (current && allowed.includes(current)) continue;

      const fallback = defaultValue(group);
      selection[group.code] = fallback && allowed.includes(fallback) ? fallback : allowed[0]!;
      changed = true;
    }
    if (!changed) return selection;
  }
  throw new Error('Option rules do not settle on a stable selection. Check for conflicting rules.');
}
