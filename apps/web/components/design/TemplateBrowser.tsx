'use client';

import { facetCounts, filterTemplates, type Template, type TemplateFacet, type TemplateFilters } from '@printing/templates';
import { useMemo, useState } from 'react';
import styles from './choose.module.css';

interface Props {
  /** Templates that support the selected size. */
  templates: Template[];
  facets: TemplateFacet[];
  selectedCode: string | null;
  /** PNG data URLs of each template's front, by template code. */
  thumbnails: Partial<Record<string, string>>;
  onSelect: (code: string) => void;
}

/** Step 2 with templates: filters on the left, the matching templates on the right. */
export function TemplateBrowser({ templates, facets, selectedCode, thumbnails, onSelect }: Props) {
  const [filters, setFilters] = useState<TemplateFilters>({});
  const shown = useMemo(() => filterTemplates(templates, filters), [templates, filters]);
  const counts = useMemo(() => facetCounts(templates, facets, filters), [templates, facets, filters]);
  const activeCount = Object.values(filters).reduce((sum, values) => sum + values.length, 0);

  function toggle(facet: string, value: string) {
    setFilters((current) => {
      const values = current[facet] ?? [];
      return { ...current, [facet]: values.includes(value) ? values.filter((v) => v !== value) : [...values, value] };
    });
  }

  if (templates.length === 0) {
    return <p className={styles.empty}>No templates are available for this size yet. Choose a standard size, or upload your own design.</p>;
  }

  return (
    <div className={styles.browser}>
      {facets.length > 0 && (
        <details className={styles.filters} open>
          <summary className={styles.filtersSummary}>
            Filters{activeCount > 0 ? ` (${activeCount})` : ''}
          </summary>
          <div className={styles.filtersBody}>
            {activeCount > 0 && (
              <button type="button" className={styles.clear} onClick={() => setFilters({})}>
                Clear all
              </button>
            )}
            {facets.map((facet) => (
              <fieldset key={facet.code} className={styles.facet}>
                <legend>{facet.name}</legend>
                {facet.values.map((value) => {
                  const count = counts[facet.code]?.[value.code] ?? 0;
                  const checked = filters[facet.code]?.includes(value.code) ?? false;
                  return (
                    <label key={value.code} className={styles.facetValue} data-empty={count === 0 && !checked ? '' : undefined}>
                      <input type="checkbox" checked={checked} onChange={() => toggle(facet.code, value.code)} />
                      <span>{value.name}</span>
                      <span className={styles.count}>{count}</span>
                    </label>
                  );
                })}
              </fieldset>
            ))}
          </div>
        </details>
      )}

      <div className={styles.results}>
        <p className={styles.resultCount} aria-live="polite">
          {shown.length} template{shown.length === 1 ? '' : 's'}
        </p>
        {shown.length === 0 ? (
          <div className={styles.empty}>
            <p>No templates match these filters.</p>
            <button type="button" className={styles.clear} onClick={() => setFilters({})}>
              Clear filters
            </button>
          </div>
        ) : (
          <ul className={styles.grid}>
            {shown.map((template) => (
              <li key={template.code}>
                <button
                  type="button"
                  className={styles.templateCard}
                  aria-current={template.code === selectedCode || undefined}
                  onClick={() => onSelect(template.code)}
                >
                  <span className={styles.templateImage}>
                    {thumbnails[template.code] ? <img src={thumbnails[template.code]} alt="" /> : null}
                  </span>
                  <span className={styles.templateName}>{template.name}</span>
                  {template.description && <span className={styles.templateText}>{template.description}</span>}
                  <span className={styles.templateAction}>{template.code === selectedCode ? 'Continue with this design' : 'Use this design'}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
