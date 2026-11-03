import { SIZE_GROUP, TURNAROUND_GROUP } from './constants.js';
import { getAllowedValues, resolveSelection, sortedGroups, turnaroundAt } from './rules.js';
import { resolveSize, type ResolvedSize } from './size.js';
import type { Catalog, Configuration, QuantityTier, Selection } from './types.js';

export interface QuoteLine {
  group: string;
  groupLabel: string;
  value: string;
  valueLabel: string;
  /** Turnaround: its percent of the printing price, already applied (size included). */
  upchargeCents: number;
  /** Turnaround only: the percent behind upchargeCents. */
  percent?: number;
}

export interface Quote {
  selection: Selection;
  quantity: number;
  size: ResolvedSize;
  basePriceCents: number;
  lines: QuoteLine[];
  /** base + upcharges, before the size multiplier and turnaround */
  subtotalCents: number;
  /** Production days of the selected turnaround at this quantity. */
  businessDays: number | null;
  totalCents: number;
  /** total / quantity, rounded to the nearest cent (display only) */
  unitPriceCents: number;
}

export class InvalidConfigurationError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Invalid configuration: ${issues.join('; ')}`);
    this.name = 'InvalidConfigurationError';
  }
}

export function sortedTiers(catalog: Catalog): QuantityTier[] {
  return [...catalog.quantityTiers].sort((a, b) => a.sortOrder - b.sortOrder);
}

export function defaultQuantity(catalog: Catalog): number {
  const tiers = sortedTiers(catalog);
  const tier = tiers.find((t) => t.isDefault) ?? tiers[0];
  if (!tier) throw new Error('Catalog has no quantity tiers');
  return tier.quantity;
}

/**
 * Lists every problem with a configuration without changing it.
 * Use on the server to reject tampered or stale requests.
 */
export function validateConfiguration(catalog: Catalog, config: Configuration): string[] {
  const issues: string[] = [];
  const allowed = getAllowedValues(catalog, config.selection, config.quantity);
  const knownQuantity = catalog.quantityTiers.some((t) => t.quantity === config.quantity);

  for (const group of sortedGroups(catalog)) {
    const value = config.selection[group.code];
    if (!value) issues.push(`Missing value for "${group.code}"`);
    else if (!group.values.some((v) => v.code === value)) issues.push(`Unknown value "${value}" for "${group.code}"`);
    // An unknown quantity offers no speed; that is reported once, below.
    else if (group.code === TURNAROUND_GROUP && !knownQuantity) continue;
    else if (!allowed[group.code]?.includes(value)) issues.push(`"${value}" is not available for "${group.code}" with the other options selected`);
  }
  for (const key of Object.keys(config.selection)) {
    if (!catalog.groups.some((g) => g.code === key)) issues.push(`Unknown option group "${key}"`);
  }
  if (!knownQuantity) {
    issues.push(`Quantity ${config.quantity} is not available`);
  }
  const sizeCode = config.selection[SIZE_GROUP];
  if (sizeCode && issues.length === 0) {
    try {
      resolveSize(catalog, sizeCode, config.customSize);
    } catch (err) {
      issues.push(err instanceof Error ? err.message : String(err));
    }
  }
  return issues;
}

/**
 * Prices a configuration (Vistaprint-style, spec §4):
 *   printing = (base_price[qty] + sum of upcharges[value][qty]) x size multiplier
 *   total    = printing + printing x turnaround percent[speed][qty]
 * Throws InvalidConfigurationError if the configuration is not valid.
 */
export function quote(catalog: Catalog, config: Configuration): Quote {
  const issues = validateConfiguration(catalog, config);
  if (issues.length > 0) throw new InvalidConfigurationError(issues);

  const tier = catalog.quantityTiers.find((t) => t.quantity === config.quantity)!;
  const size = resolveSize(catalog, config.selection[SIZE_GROUP]!, config.customSize);
  const selection: Selection = { ...config.selection, [SIZE_GROUP]: size.code };

  const lines: QuoteLine[] = sortedGroups(catalog)
    .filter((group) => group.code !== SIZE_GROUP)
    .map((group) => {
      const valueCode = selection[group.code]!;
      const value = group.values.find((v) => v.code === valueCode)!;
      return {
        group: group.code,
        groupLabel: group.label,
        value: valueCode,
        valueLabel: value.label,
        upchargeCents: group.code === TURNAROUND_GROUP ? 0 : upchargeFor(catalog, group.code, valueCode, tier.quantity),
      };
    });

  const subtotalCents = tier.basePriceCents + lines.reduce((sum, line) => sum + line.upchargeCents, 0);
  const printingCents = Math.round(subtotalCents * size.priceMultiplier);
  const turnaround = turnaroundAt(catalog, selection[TURNAROUND_GROUP] ?? '', tier.quantity);
  const turnaroundLine = lines.find((line) => line.group === TURNAROUND_GROUP);
  let totalCents = printingCents;
  if (turnaround && turnaroundLine) {
    turnaroundLine.percent = turnaround.percent;
    turnaroundLine.upchargeCents = Math.round((printingCents * turnaround.percent) / 100);
    totalCents += turnaroundLine.upchargeCents;
  }

  return {
    selection,
    quantity: tier.quantity,
    size,
    basePriceCents: tier.basePriceCents,
    lines,
    subtotalCents,
    businessDays: turnaround?.businessDays ?? null,
    totalCents,
    unitPriceCents: Math.round(totalCents / tier.quantity),
  };
}

/** Upcharge of an option value at a quantity (0 when none is set). Turnaround uses percents instead. */
export function upchargeFor(catalog: Catalog, group: string, value: string, quantity: number): number {
  return (
    catalog.upcharges.find((u) => u.group === group && u.value === value && u.quantity === quantity)?.upchargeCents ?? 0
  );
}

/** Convenience for UIs: resolve a stale/partial selection, then price it. */
export function resolveAndQuote(catalog: Catalog, config: Configuration): Quote {
  return quote(catalog, { ...config, selection: resolveSelection(catalog, config.selection, config.quantity) });
}
