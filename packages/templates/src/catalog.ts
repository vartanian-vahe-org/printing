/**
 * How customers choose a design (step 2 of the product page): template filters and the
 * "let us design it for you" packages, as served by the API and configured in the admin.
 */
import type { Template } from './layout.js';

/** A template filter such as Industry or Style, with its values in display order. */
export interface TemplateFacet {
  code: string;
  name: string;
  values: { code: string; name: string }[];
}

/** A design service package (e.g. Standard, Premium, Elite) for one product. */
export interface DesignServiceTier {
  code: string;
  name: string;
  description: string | null;
  priceCents: number;
  /** What the package includes, one line each. */
  features: string[];
  /** Business days until the first draft. */
  designDays: number;
  /** Rounds of changes included; null = unlimited. */
  revisions: number | null;
}

/** Selected filter values by facet code. */
export type TemplateFilters = Record<string, string[]>;

/**
 * Templates matching the filters: within one facet any selected value matches (OR), across facets
 * every facet must match (AND). Facets with nothing selected do not filter.
 */
export function filterTemplates<T extends Pick<Template, 'tags'>>(templates: T[], filters: TemplateFilters): T[] {
  const active = Object.entries(filters).filter(([, values]) => values.length > 0);
  return templates.filter((template) =>
    active.every(([facet, values]) => (template.tags?.[facet] ?? []).some((value) => values.includes(value))),
  );
}

/** How many templates each value would show, given the other facets' selections. */
export function facetCounts<T extends Pick<Template, 'tags'>>(
  templates: T[],
  facets: TemplateFacet[],
  filters: TemplateFilters,
): Record<string, Record<string, number>> {
  const counts: Record<string, Record<string, number>> = {};
  for (const facet of facets) {
    const others = filterTemplates(templates, { ...filters, [facet.code]: [] });
    counts[facet.code] = Object.fromEntries(
      facet.values.map((value) => [value.code, others.filter((t) => (t.tags?.[facet.code] ?? []).includes(value.code)).length]),
    );
  }
  return counts;
}
