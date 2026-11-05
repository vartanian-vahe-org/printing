import { CORE_GROUPS, SIZE_GROUP, TURNAROUND_GROUP } from './constants.js';
import { corePriceAt, getAllowedValues, resolveSelection, sortedGroups, turnaroundAt } from './rules.js';
import { resolveSize, type ResolvedSize } from './size.js';
import type { Catalog, Configuration, QuantityTier, Selection } from './types.js';

export interface QuoteLine {
  group: string;
  groupLabel: string;
  value: string;
  valueLabel: string;
  /** What this option adds to the price; 0 for core options, which are in corePriceCents. */
  upchargeCents: number;
  /** The percent behind upchargeCents: of the core price for add-ons, of the printing price for turnaround. */
  percent?: number;
}

export interface Quote {
  selection: Selection;
  quantity: number;
  size: ResolvedSize;
  /** Set price of the size, paper and printed sides at this quantity. */
  corePriceCents: number;
  lines: QuoteLine[];
  /** Core price + add-ons, before turnaround. */
  printingCents: number;
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
  if (issues.length === 0 && !corePriceAt(catalog, config.selection, config.quantity)) {
    issues.push(`Quantity ${config.quantity} is not available with these options`);
  }
  return issues;
}

/**
 * Prices a configuration:
 *   printing = core price[size, paper, printed sides, qty] + sum of core price x add-on percent
 *   total    = printing + printing x turnaround percent[speed][qty]
 * Throws InvalidConfigurationError if the configuration is not valid.
 */
export function quote(catalog: Catalog, config: Configuration): Quote {
  const issues = validateConfiguration(catalog, config);
  if (issues.length > 0) throw new InvalidConfigurationError(issues);

  const { selection, quantity } = config;
  const corePriceCents = corePriceAt(catalog, selection, quantity)!.priceCents;
  const core: readonly string[] = CORE_GROUPS;

  const lines: QuoteLine[] = sortedGroups(catalog)
    .filter((group) => group.code !== SIZE_GROUP)
    .map((group) => {
      const value = group.values.find((v) => v.code === selection[group.code])!;
      const line = { group: group.code, groupLabel: group.label, value: value.code, valueLabel: value.label, upchargeCents: 0 };
      if (core.includes(group.code) || group.code === TURNAROUND_GROUP) return line;
      return { ...line, upchargeCents: Math.round((corePriceCents * value.addonPercent) / 100), percent: value.addonPercent };
    });

  const printingCents = corePriceCents + lines.reduce((sum, line) => sum + line.upchargeCents, 0);
  const turnaround = turnaroundAt(catalog, selection[TURNAROUND_GROUP] ?? '', quantity);
  const turnaroundLine = lines.find((line) => line.group === TURNAROUND_GROUP);
  let totalCents = printingCents;
  if (turnaround && turnaroundLine) {
    turnaroundLine.percent = turnaround.percent;
    turnaroundLine.upchargeCents = Math.round((printingCents * turnaround.percent) / 100);
    totalCents += turnaroundLine.upchargeCents;
  }

  return {
    selection,
    quantity,
    size: resolveSize(catalog, selection[SIZE_GROUP]!),
    corePriceCents,
    lines,
    printingCents,
    businessDays: turnaround?.businessDays ?? null,
    totalCents,
    unitPriceCents: Math.round(totalCents / quantity),
  };
}

/** Convenience for UIs: resolve a stale/partial selection, then price it. */
export function resolveAndQuote(catalog: Catalog, config: Configuration): Quote {
  return quote(catalog, { ...config, selection: resolveSelection(catalog, config.selection, config.quantity) });
}
