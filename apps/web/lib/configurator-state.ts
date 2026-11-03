/**
 * Pure configurator state logic for the homepage (no React), built on @printing/pricing.
 */
import {
  CUSTOM_SIZE_VALUE,
  quote,
  resolveSelection,
  resolveSize,
  ruleAllowedValues,
  SIZE_GROUP,
  sortedTiers,
  TURNAROUND_GROUP,
  turnaroundAt,
  type Catalog,
  type CustomSize,
  type CustomSizeAttributes,
  type Quote,
  type Selection,
} from '@printing/pricing';

export interface ConfiguratorState {
  selection: Selection;
  quantity: number;
  /** Kept even when a preset size is selected, so switching back to Custom restores it. */
  customSize: CustomSize;
}

/** A value the engine changed automatically because of a rule (shown to the customer). */
export interface AutoChange {
  group: string;
  from: string;
  to: string;
}

/** Starting custom size: 3" x 2.5" (inside the 2"-4" range and not equal to any preset). */
const INITIAL_CUSTOM_SIZE: CustomSize = { widthIn: 3, heightIn: 2.5 };

export function customSizeAttributes(catalog: Catalog): CustomSizeAttributes | null {
  const value = catalog.groups
    .find((g) => g.code === SIZE_GROUP)
    ?.values.find((v) => v.code === CUSTOM_SIZE_VALUE);
  return value ? (value.attributes as unknown as CustomSizeAttributes) : null;
}

/** Allowed custom dimensions, e.g. [2, 2.25, ..., 4]. */
export function customSizeSteps(attrs: CustomSizeAttributes): number[] {
  const steps: number[] = [];
  const count = Math.round((attrs.max_in - attrs.min_in) / attrs.step_in);
  for (let i = 0; i <= count; i++) steps.push(Number((attrs.min_in + i * attrs.step_in).toFixed(4)));
  return steps;
}

export function initialState(catalog: Catalog, defaults: { selection: Selection; quantity: number }): ConfiguratorState {
  return {
    selection: resolveSelection(catalog, defaults.selection, defaults.quantity),
    quantity: defaults.quantity,
    customSize: { ...INITIAL_CUSTOM_SIZE },
  };
}

function diff(before: Selection, after: Selection, except: string): AutoChange[] {
  return Object.keys(after)
    .filter((group) => group !== except && before[group] !== after[group])
    .map((group) => ({ group, from: before[group]!, to: after[group]! }));
}

/** Customer picked a value; dependent groups are fixed up by the rules. */
export function changeOption(
  catalog: Catalog,
  state: ConfiguratorState,
  group: string,
  value: string,
): { state: ConfiguratorState; autoChanges: AutoChange[] } {
  const selection = resolveSelection(catalog, { ...state.selection, [group]: value }, state.quantity);
  return { state: { ...state, selection }, autoChanges: diff(state.selection, selection, group) };
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

/**
 * Customer changed custom width/height. If it exactly matches a preset, the size switches
 * to that preset (spec §2.1), reported as an auto change.
 */
export function changeCustomSize(
  catalog: Catalog,
  state: ConfiguratorState,
  customSize: CustomSize,
): { state: ConfiguratorState; autoChanges: AutoChange[] } {
  const next = { ...state, customSize };
  const resolved = resolveSize(catalog, CUSTOM_SIZE_VALUE, customSize);
  if (resolved.code === CUSTOM_SIZE_VALUE) return { state: next, autoChanges: [] };

  const selection = { ...state.selection, [SIZE_GROUP]: resolved.code };
  return {
    state: { ...next, selection, customSize: { ...INITIAL_CUSTOM_SIZE } },
    autoChanges: [{ group: SIZE_GROUP, from: CUSTOM_SIZE_VALUE, to: resolved.code }],
  };
}

function configurationOf(state: ConfiguratorState, selection = state.selection, quantity = state.quantity) {
  return {
    selection,
    quantity,
    customSize: selection[SIZE_GROUP] === CUSTOM_SIZE_VALUE ? state.customSize : undefined,
  };
}

export function priceOf(catalog: Catalog, state: ConfiguratorState): Quote {
  return quote(catalog, configurationOf(state));
}

/**
 * Price difference of picking each allowed value instead of the current one, for the
 * "$1.75" / "Save $2.50" hints. Works for upcharges and size multipliers alike. null = cannot be priced.
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
        result[group][value] = quote(catalog, configurationOf(state, selection)).totalCents - current;
      } catch {
        result[group][value] = null;
      }
    }
  }
  return result;
}

/**
 * Total and per-card price at every quantity tier for the current options. Where the current speed is
 * not offered, the price is that of the speed the customer would be switched to.
 */
export function tierPrices(catalog: Catalog, state: ConfiguratorState) {
  return sortedTiers(catalog).map((tier) => {
    const selection = resolveSelection(catalog, state.selection, tier.quantity);
    const q = quote(catalog, configurationOf(state, selection, tier.quantity));
    return { quantity: tier.quantity, isDefault: tier.isDefault, totalCents: q.totalCents, unitPriceCents: q.unitPriceCents };
  });
}

/** A turnaround speed as the tiles show it: production days at this quantity, or why it cannot be picked. */
export interface SpeedChoice {
  code: string;
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
    if (here) return [{ code, businessDays: here.businessDays, unavailable: null }];
    const offered = quantities.filter((q) => turnaroundAt(catalog, code, q));
    if (offered.length === 0) return [];
    const below = offered.filter((q) => q < state.quantity);
    const unavailable = below.length
      ? `Up to ${count.format(below.at(-1)!)} cards`
      : `From ${count.format(offered[0]!)} cards`;
    return [{ code, businessDays: null, unavailable }];
  });
}

export function valueLabel(catalog: Catalog, group: string, value: string): string {
  return catalog.groups.find((g) => g.code === group)?.values.find((v) => v.code === value)?.label ?? value;
}

export function groupLabel(catalog: Catalog, group: string): string {
  return catalog.groups.find((g) => g.code === group)?.label ?? group;
}
