import { useState, type FormEvent } from 'react';
import { api, type AdminDesignService } from '../api';
import { useCatalog, useSaver } from '../catalog';
import { Toast } from '../components/Toast';
import { money } from '../orders';

type TierFields = Omit<AdminDesignService, 'code' | 'sortOrder'>;

/**
 * "Let us design it for you" packages of the product picked in the sidebar. Each product has its own
 * list: business cards and postcards can offer different packages at different prices.
 */
export function DesignServicesPage() {
  const { catalog, product, path } = useCatalog();
  const saver = useSaver();
  const [adding, setAdding] = useState(false);
  if (!catalog) return <p className="page-loading">Loading…</p>;
  const tiers = catalog.designServices;
  const productName = product?.name ?? catalog.product.name;

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>Design services · {productName}</h1>
          <p className="muted">
            Packages customers of {productName} can buy instead of designing it themselves. The fee is added once per design. Every
            product has its own packages and prices. Hidden or deleted packages disappear from the storefront; orders already placed
            keep the package they bought.
          </p>
        </div>
      </header>

      <div className="card">
        {tiers.map((tier, index) => (
          <TierRow
            key={`${tier.code}-${JSON.stringify(tier)}`}
            tier={tier}
            neighbours={[tiers[index - 1], tiers[index + 1]]}
            saver={saver}
          />
        ))}
        {tiers.length === 0 && !adding && (
          <p className="value-row muted">No packages: "Let us design it for you" is not offered for {productName}.</p>
        )}
        <div className="value-row value-add">
          {adding ? (
            <TierForm
              title="New package"
              // Starts from the last package's details so a new one only needs what is different.
              initial={{ ...(tiers.at(-1) ?? { description: null, priceCents: 0, features: [], designDays: 1, revisions: null, isActive: true }), name: '' }}
              submitText="Add package"
              busy={saver.saving}
              onCancel={() => setAdding(false)}
              onSubmit={async (fields) => {
                const ok = await saver.save(() => api(`${path}/design-services`, { method: 'POST', body: fields }), `${fields.name} added`);
                if (ok) setAdding(false);
              }}
            />
          ) : (
            <button type="button" className="btn btn-small" onClick={() => setAdding(true)}>
              + Add package
            </button>
          )}
        </div>
      </div>
      <Toast status={saver.status} onClose={saver.clearStatus} />
    </div>
  );
}

function revisionsText(revisions: number | null): string {
  return revisions === null ? 'unlimited changes' : `${revisions} round${revisions === 1 ? '' : 's'} of changes`;
}

function TierRow({
  tier,
  neighbours,
  saver,
}: {
  tier: AdminDesignService;
  neighbours: [AdminDesignService | undefined, AdminDesignService | undefined];
  saver: ReturnType<typeof useSaver>;
}) {
  const { path: productPath } = useCatalog();
  const [open, setOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const path = `${productPath}/design-services/${tier.code}`;
  const patch = (body: Partial<AdminDesignService>, text: string) => saver.save(() => api(path, { method: 'PATCH', body }), text);

  async function move(direction: -1 | 1) {
    const other = neighbours[direction === -1 ? 0 : 1];
    if (!other) return;
    await saver.save(async () => {
      await api(path, { method: 'PATCH', body: { sortOrder: other.sortOrder } });
      await api(`${productPath}/design-services/${other.code}`, { method: 'PATCH', body: { sortOrder: tier.sortOrder } });
    }, 'Order updated');
  }

  return (
    <div className={`value-row ${tier.isActive ? '' : 'value-hidden'}`}>
      <div className="value-summary">
        <div className="value-order">
          <button type="button" className="icon-btn" disabled={!neighbours[0] || saver.saving} onClick={() => void move(-1)} aria-label="Move up">
            ↑
          </button>
          <button type="button" className="icon-btn" disabled={!neighbours[1] || saver.saving} onClick={() => void move(1)} aria-label="Move down">
            ↓
          </button>
        </div>
        <div className="value-main">
          <div className="value-label">
            {tier.name} · {money(tier.priceCents)}
            {!tier.isActive && <span className="badge">Hidden</span>}
          </div>
          <span className="muted">
            First draft in {tier.designDays} business day{tier.designDays === 1 ? '' : 's'} · {revisionsText(tier.revisions)}
            {tier.description ? ` · ${tier.description}` : ''}
          </span>
          <code className="value-code">{tier.code}</code>
        </div>
        <div className="value-actions">
          <button
            type="button"
            className="btn btn-small"
            disabled={saver.saving}
            onClick={() => void patch({ isActive: !tier.isActive }, tier.isActive ? `${tier.name} hidden` : `${tier.name} shown`)}
          >
            {tier.isActive ? 'Hide' : 'Show'}
          </button>
          <button
            type="button"
            className="btn btn-small"
            aria-expanded={open}
            onClick={() => {
              setOpen(!open);
              setConfirmDelete(false);
            }}
          >
            {open ? 'Close' : 'Edit'}
          </button>
        </div>
      </div>

      {open && (
        <>
          <TierForm
            initial={tier}
            submitText={`Save ${tier.name}`}
            busy={saver.saving}
            onCancel={() => setOpen(false)}
            onDelete={() => setConfirmDelete(true)}
            onSubmit={async (fields) => {
              if (await patch(fields, `${fields.name} saved`)) setOpen(false);
            }}
          />
          {confirmDelete && (
            <div className="confirm-box" role="alert">
              <p>
                Delete the <strong>{tier.name}</strong> package? Carts holding it ask the customer to choose again; orders already placed
                keep it. To stop offering it for a while, use Hide instead.
              </p>
              <div className="form-actions">
                <button
                  type="button"
                  className="btn btn-danger"
                  disabled={saver.saving}
                  onClick={() => void saver.save(() => api(path, { method: 'DELETE' }), `${tier.name} deleted`)}
                >
                  Delete
                </button>
                <button type="button" className="btn btn-ghost" onClick={() => setConfirmDelete(false)}>
                  Keep it
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function TierForm(props: {
  title?: string;
  initial: TierFields;
  submitText: string;
  busy: boolean;
  onSubmit: (fields: TierFields) => Promise<void>;
  onCancel: () => void;
  onDelete?: () => void;
}) {
  const { title, initial, submitText, busy, onSubmit, onCancel, onDelete } = props;
  const [name, setName] = useState(initial.name);
  const [price, setPrice] = useState((initial.priceCents / 100).toFixed(2));
  const [description, setDescription] = useState(initial.description ?? '');
  const [features, setFeatures] = useState(initial.features.join('\n'));
  const [designDays, setDesignDays] = useState(String(initial.designDays));
  const [revisions, setRevisions] = useState(initial.revisions === null ? '' : String(initial.revisions));
  const [isActive, setIsActive] = useState(initial.isActive);
  const [error, setError] = useState<string | null>(null);

  function submit(event: FormEvent) {
    event.preventDefault();
    const priceCents = Math.round(Number(price) * 100);
    const days = Number(designDays);
    const rounds = revisions.trim() === '' ? null : Number(revisions);
    if (!name.trim()) return setError('Enter a name.');
    if (!Number.isFinite(priceCents) || priceCents < 0) return setError('Enter a price of $0.00 or more.');
    if (!Number.isInteger(days) || days < 1 || days > 60) return setError('First draft must be 1 to 60 business days.');
    if (rounds !== null && (!Number.isInteger(rounds) || rounds < 0)) return setError('Rounds of changes must be a whole number, or empty for unlimited.');
    setError(null);
    void onSubmit({
      name: name.trim(),
      priceCents,
      description: description.trim() || null,
      features: features.split('\n').map((line) => line.trim()).filter(Boolean),
      designDays: days,
      revisions: rounds,
      isActive,
    });
  }

  return (
    <form className={`value-form ${title ? 'value-form-new' : ''}`} onSubmit={submit}>
      {title && <h3 className="form-subtitle">{title}</h3>}
      <div className="form-grid">
        <label className="field">
          <span>Name</span>
          <input value={name} maxLength={60} required onChange={(e) => setName(e.target.value)} autoFocus={Boolean(title)} />
        </label>
        <label className="field">
          <span>Price (USD)</span>
          <input type="number" min="0" step="0.01" value={price} required onChange={(e) => setPrice(e.target.value)} />
        </label>
        <label className="field">
          <span>First draft in (business days)</span>
          <input type="number" min="1" max="60" step="1" value={designDays} required onChange={(e) => setDesignDays(e.target.value)} />
        </label>
        <label className="field">
          <span>Rounds of changes included</span>
          <input type="number" min="0" step="1" value={revisions} placeholder="Unlimited" onChange={(e) => setRevisions(e.target.value)} />
        </label>
      </div>
      <label className="field" style={{ marginTop: 12 }}>
        <span>Short description</span>
        <input value={description} maxLength={300} onChange={(e) => setDescription(e.target.value)} />
      </label>
      <label className="field" style={{ marginTop: 12 }}>
        <span>What is included (one per line)</span>
        <textarea className="textarea" rows={4} value={features} onChange={(e) => setFeatures(e.target.value)} />
        <small className="muted">The first draft time and rounds of changes are shown on the storefront already; no need to repeat them here.</small>
      </label>
      <label className="check" style={{ marginTop: 12 }}>
        <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
        Offered on the storefront
      </label>
      {error && <p className="form-error">{error}</p>}
      <div className="form-actions">
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {submitText}
        </button>
        <button type="button" className="btn btn-ghost" onClick={onCancel}>
          Cancel
        </button>
        {onDelete && (
          <>
            <span className="form-actions-spacer" />
            <button type="button" className="btn btn-ghost btn-danger-text" onClick={onDelete}>
              Delete package
            </button>
          </>
        )}
      </div>
    </form>
  );
}
