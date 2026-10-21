import type { Catalog, OptionGroup, Selection } from './types.js';

export function sortedGroups(catalog: Catalog): OptionGroup[] {
  return [...catalog.groups].sort((a, b) => a.sortOrder - b.sortOrder);
}

function sortedValueCodes(group: OptionGroup): string[] {
  return [...group.values].sort((a, b) => a.sortOrder - b.sortOrder).map((v) => v.code);
}

/**
 * Values each group may use given the current selection of the OTHER groups.
 * Rules triggered by the current selection restrict their target group; several
 * rules on the same group intersect. Result keeps the group's sort order.
 */
export function getAllowedValues(catalog: Catalog, selection: Selection): Record<string, string[]> {
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
 *  - values hidden by rules are replaced by the group default if allowed,
 *    otherwise by the first allowed value in sort order.
 * Changes can cascade (paper -> coating -> turnaround), so it repeats until stable.
 */
export function resolveSelection(catalog: Catalog, input: Selection): Selection {
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
      const allowed = getAllowedValues(catalog, selection)[group.code] ?? [];
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
