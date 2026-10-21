import { api, productPath } from '../api';
import { useCatalog, useSaver } from '../catalog';
import { Toast } from '../components/Toast';

const SIZE_LABELS: Record<string, string> = {
  std_3_5x2: 'Standard',
  square_2_5: 'Square',
  slim_3_5x1_75: 'Slim',
  custom: 'Custom',
};

export function TemplatesPage() {
  const { catalog } = useCatalog();
  const saver = useSaver();
  if (!catalog) return <p className="page-loading">Loading…</p>;

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>Templates</h1>
          <p className="muted">Hidden templates disappear from the storefront picker. Editing layouts comes later.</p>
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
              </div>
              <div className="value-actions">
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
          </div>
        ))}
      </div>
      <Toast status={saver.status} onClose={saver.clearStatus} />
    </div>
  );
}
