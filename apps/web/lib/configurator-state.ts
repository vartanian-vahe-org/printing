/**
 * Pure configurator state logic for the homepage (no React), built on @printing/pricing.
 */
import {
  corePriceAt,
  nearestQuantity,
  quote,
  resolveSelection,
  ruleAllowedValues,
  sortedTiers,
  TURNAROUND_GROUP,
  turnaroundAt,
  type Catalog,
  type Quote,
  type Selection,
} from '@printing/pricing';

export interface ConfiguratorState {
  selection: Selection;
  quantity: number;
}

/** AutoChange.group of a quantity moved because the new options are not sold at the old one. */
export const QUANTITY_CHANGE = 'quantity';

/** A value the engine changed automatically because of a rule (shown to the customer). */
export interface AutoChange {
  group: string;
  from: string;
  to: string;
}

/**
 * Turns any (stale) selection and quantity into ones that can be priced. A quantity not sold for these
 * options moves to the nearest one sold; turnaround then follows the new quantity.
 */
export function settle(catalog: Catalog, input: Selection, requested: number): ConfiguratorState {
  const tiers = sortedTiers(catalog).map((t) => t.quantity);
  const known = tiers.find((q) => q >= requested) ?? tiers.at(-1)!;
  const resolved = resolveSelection(catalog, input, known);
  const quantity = nearestQuantity(catalog, resolved, known);
  return { selection: quantity === known ? resolved : resolveSelection(catalog, resolved, quantity), quantity };
}

export function initialState(catalog: Catalog, defaults: { selection: Selection; quantity: number }): ConfiguratorState {
  return settle(catalog, defaults.selection, defaults.quantity);
}

function diff(before: Selection, after: Selection, except: string): AutoChange[] {
  return Object.keys(after)
    .filter((group) => group !== except && before[group] !== after[group])
    .map((group) => ({ group, from: before[group]!, to: after[group]! }));
}

function quantityChange(before: number, after: number): AutoChange[] {
  return before === after ? [] : [{ group: QUANTITY_CHANGE, from: String(before), to: String(after) }];
}

/** Customer picked a value; dependent groups, and the quantity if need be, are fixed up. */
export function changeOption(
  catalog: Catalog,
  state: ConfiguratorState,
  group: string,
  value: string,
): { state: ConfiguratorState; autoChanges: AutoChange[] } {
  const next = settle(catalog, { ...state.selection, [group]: value }, state.quantity);
  return { state: next, autoChanges: [...diff(state.selection, next.selection, group), ...quantityChange(state.quantity, next.quantity)] };
}

/** Customer picked a quantity; a turnaround speed not offered there is switched (reported as an auto change). */
export function changeQuantity(
  catalog: Catalog,
  state: ConfiguratorState,
  quantity: number,
): { state: ConfiguratorState; autoChanges: AutoChange[] } {
  const selection = resolveSelection(catalog, state.selection, quantity);
  return { state: { ...state, quantity, selection }, autoChanges: diff(state.selection, selection, '') };
}

export function priceOf(catalog: Catalog, state: ConfiguratorState): Quote {
  return quote(catalog, state);
}

/**
 * Price difference of picking each allowed value instead of the current one, for the
 * "$1.75" / "Save $2.50" hints. null = cannot be priced at the current quantity.
 */
export function optionDeltas(
  catalog: Catalog,
  state: ConfiguratorState,
  allowed: Record<string, string[]>,
): Record<string, Record<string, number | null>> {
  const current = priceOf(catalog, state).totalCents;
  const result: Record<string, Record<string, number | null>> = {};
  for (const [group, values] of Object.entries(allowed)) {
    result[group] = {};
    for (const value of values) {
      try {
        const selection = resolveSelection(catalog, { ...state.selection, [group]: value }, state.quantity);
        result[group][value] = quote(catalog, { selection, quantity: state.quantity }).totalCents - current;
      } catch {
        result[group][value] = null;
      }
    }
  }
  return result;
}

/**
 * Total and per-item price at every quantity sold for the current options. Where the current speed
 * is not offered, the price is that of the speed the customer would be switched to.
 */
export function tierPrices(catalog: Catalog, state: ConfiguratorState) {
  return sortedTiers(catalog).flatMap((tier) => {
    if (!corePriceAt(catalog, state.selection, tier.quantity)) return [];
    const selection = resolveSelection(catalog, state.selection, tier.quantity);
    const q = quote(catalog, { selection, quantity: tier.quantity });
    return [{ quantity: tier.quantity, isDefault: tier.isDefault, totalCents: q.totalCents, unitPriceCents: q.unitPriceCents }];
  });
}

/** A turnaround speed as the tiles show it: production days at this quantity, or why it cannot be picked. */
export interface SpeedChoice {
  code: string;
  minBusinessDays: number | null;
  businessDays: number | null;
  /** Set when the speed is not offered at the current quantity, e.g. "Up to 5,000 cards". */
  unavailable: string | null;
}

const count = new Intl.NumberFormat('en-US');

/**
 * Every speed the rules allow with the current options, including those not offered at the current
 * quantity (shown dimmed with the quantities that do have it). Speeds hidden by rules are left out.
 */
export function speedChoices(catalog: Catalog, state: ConfiguratorState): SpeedChoice[] {
  const quantities = sortedTiers(catalog).map((t) => t.quantity);
  return (ruleAllowedValues(catalog, state.selection)[TURNAROUND_GROUP] ?? []).flatMap((code): SpeedChoice[] => {
    const here = turnaroundAt(catalog, code, state.quantity);
    if (here) return [{ code, minBusinessDays: here.minBusinessDays, businessDays: here.businessDays, unavailable: null }];
    const offered = quantities.filter((q) => turnaroundAt(catalog, code, q));
    if (offered.length === 0) return [];
    const below = offered.filter((q) => q < state.quantity);
    const unit = catalog.product.unitNamePlural;
    const unavailable = below.length ? `Up to ${count.format(below.at(-1)!)} ${unit}` : `From ${count.format(offered[0]!)} ${unit}`;
    return [{ code, minBusinessDays: null, businessDays: null, unavailable }];
  });
}

export function valueLabel(catalog: Catalog, group: string, value: string): string {
  if (group === QUANTITY_CHANGE) return count.format(Number(value));
  return catalog.groups.find((g) => g.code === group)?.values.find((v) => v.code === value)?.label ?? value;
}

export function groupLabel(catalog: Catalog, group: string): string {
  if (group === QUANTITY_CHANGE) return 'Quantity';
  return catalog.groups.find((g) => g.code === group)?.label ?? group;
}
