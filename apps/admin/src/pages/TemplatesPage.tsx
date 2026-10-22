import { useState } from 'react';
import { api, productPath, type AdminFacet, type AdminTemplate } from '../api';
import { useCatalog, useSaver } from '../catalog';
import { Toast } from '../components/Toast';

const SIZE_LABELS: Record<string, string> = {
  std_3_5x2: 'Standard',
  square_2_5: 'Square',
  slim_3_5x1_75: 'Slim',
  custom: 'Custom',
};

/** "Real Estate & Rentals" -> "real-estate-rentals" */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, ' ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

export function TemplatesPage() {
  const { catalog } = useCatalog();
  const saver = useSaver();
  const [editing, setEditing] = useState<string | null>(null);
  if (!catalog) return <p className="page-loading">Loading…</p>;
  const facets = catalog.templateFacets;

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>Templates</h1>
          <p className="muted">
            Hidden templates disappear from the storefront. Filters (Industry, Style…) help customers find a template; tag each template with
            the values that fit. Editing layouts comes later.
          </p>
        </div>
      </header>

      <div className="card">
        {catalog.templates.map((template) => (
          <div key={template.code} className={`value-row ${template.isActive ? '' : 'value-hidden'}`}>
            <div className="value-summary">
              <div className="value-main">
                <div className="value-label">
                  {template.name}
                  {!template.isActive && <span className="badge">Hidden</span>}
                </div>
                <span className="muted">{template.description}</span>
                <span className="value-code">
                  Sizes: {template.supportedSizeCodes.map((code) => SIZE_LABELS[code] ?? code).join(', ')}
                </span>
                <TagSummary template={template} facets={facets} />
              </div>
              <div className="value-actions">
                <button type="button" className="btn btn-small" onClick={() => setEditing(editing === template.code ? null : template.code)}>
                  {editing === template.code ? 'Close' : 'Filters'}
                </button>
                <button
                  type="button"
                  className="btn btn-small"
                  disabled={saver.saving}
                  onClick={() =>
                    void saver.save(
                      () => api(`${productPath}/templates/${template.code}`, { method: 'PATCH', body: { isActive: !template.isActive } }),
                      template.isActive ? `${template.name} hidden` : `${template.name} shown`,
                    )
                  }
                >
                  {template.isActive ? 'Hide' : 'Show'}
                </button>
              </div>
            </div>
            {editing === template.code && (
              <TagEditor
                key={JSON.stringify(template.tags)}
                template={template}
                facets={facets}
                busy={saver.saving}
                onSave={async (tags) => {
                  const ok = await saver.save(
                    () => api(`${productPath}/templates/${template.code}`, { method: 'PATCH', body: { tags } }),
                    `Filters of ${template.name} saved`,
                  );
                  if (ok) setEditing(null);
                }}
              />
            )}
          </div>
        ))}
      </div>

      <FacetEditor
        key={JSON.stringify(facets)}
        facets={facets}
        busy={saver.saving}
        onSave={(next) => saver.save(() => api(`${productPath}/template-filters`, { method: 'PUT', body: { facets: next } }), 'Template filters saved')}
      />
      <Toast status={saver.status} onClose={saver.clearStatus} />
    </div>
  );
}

function TagSummary({ template, facets }: { template: AdminTemplate; facets: AdminFacet[] }) {
  const names = facets.flatMap((facet) =>
    (template.tags[facet.code] ?? []).map((code) => facet.values.find((v) => v.code === code)?.name ?? code),
  );
  if (names.length === 0) return <span className="value-code">No filters yet: customers only find it without filters.</span>;
  return (
    <div className="tag-list">
      {names.map((name) => (
        <span key={name} className="badge">
          {name}
        </span>
      ))}
    </div>
  );
}

function TagEditor(props: { template: AdminTemplate; facets: AdminFacet[]; busy: boolean; onSave: (tags: Record<string, string[]>) => Promise<void> }) {
  const { template, facets, busy, onSave } = props;
  const [tags, setTags] = useState<Record<string, string[]>>(template.tags);
  const toggle = (facet: string, value: string) =>
    setTags((t) => {
      const current = t[facet] ?? [];
      return { ...t, [facet]: current.includes(value) ? current.filter((v) => v !== value) : [...current, value] };
    });

  if (facets.length === 0) return <p className="value-form muted">Add filters below first.</p>;
  return (
    <div className="value-form">
      <div className="tag-editor">
        {facets.map((facet) => (
          <fieldset key={facet.code}>
            <legend>{facet.name}</legend>
            {facet.values.map((value) => (
              <label key={value.code} className="check">
                <input type="checkbox" checked={tags[facet.code]?.includes(value.code) ?? false} onChange={() => toggle(facet.code, value.code)} />
                {value.name}
              </label>
            ))}
          </fieldset>
        ))}
      </div>
      <div className="form-actions">
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void onSave(tags)}>
          Save filters
        </button>
      </div>
    </div>
  );
}

interface FacetDraft {
  /** Existing filters keep their code (and the templates tagged with it). */
  code: string | null;
  name: string;
  /** One value per line. */
  values: string;
}

/** Turns the drafts into filters, keeping the codes of values whose name did not change. */
function toFacets(drafts: FacetDraft[], before: AdminFacet[]): AdminFacet[] {
  return drafts
    .filter((d) => d.name.trim())
    .map((d) => {
      const previous = before.find((f) => f.code === d.code);
      const names = [...new Set(d.values.split('\n').map((v) => v.trim()).filter(Boolean))];
      return {
        code: d.code ?? slugify(d.name),
        name: d.name.trim(),
        values: names.map((name) => ({ code: previous?.values.find((v) => v.name === name)?.code ?? slugify(name), name })),
      };
    });
}

function FacetEditor({ facets, busy, onSave }: { facets: AdminFacet[]; busy: boolean; onSave: (facets: AdminFacet[]) => Promise<boolean> }) {
  const [drafts, setDrafts] = useState<FacetDraft[]>(() => facets.map((f) => ({ code: f.code, name: f.name, values: f.values.map((v) => v.name).join('\n') })));
  const update = (index: number, patch: Partial<FacetDraft>) => setDrafts((d) => d.map((draft, i) => (i === index ? { ...draft, ...patch } : draft)));

  return (
    <section className="card card-pad">
      <h2>Filters</h2>
      <p className="muted">
        Shown next to the template list on the storefront, in this order. One value per line. Renaming a value removes it from the templates
        tagged with it; removing a filter removes it everywhere.
      </p>
      <div className="facet-editor" style={{ marginTop: 12 }}>
        {drafts.map((draft, index) => (
          <div key={index} className="facet-card">
            <label className="field">
              <span>Filter name</span>
              <input value={draft.name} maxLength={60} onChange={(e) => update(index, { name: e.target.value })} />
            </label>
            <label className="field">
              <span>Values</span>
              <textarea className="textarea" rows={7} value={draft.values} onChange={(e) => update(index, { values: e.target.value })} />
            </label>
            <button type="button" className="link-btn" onClick={() => setDrafts((d) => d.filter((_, i) => i !== index))}>
              Remove filter
            </button>
          </div>
        ))}
      </div>
      <div className="form-actions">
        <button type="button" className="btn" onClick={() => setDrafts((d) => [...d, { code: null, name: '', values: '' }])}>
          Add filter
        </button>
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void onSave(toFacets(drafts, facets))}>
          Save filters
        </button>
      </div>
    </section>
  );
}
