import { useState, type FormEvent } from 'react';
import { api, productPath, type AdminDesignService } from '../api';
import { useCatalog, useSaver } from '../catalog';
import { Toast } from '../components/Toast';
import { money } from '../orders';

/** "Let us design it for you" packages: price, what is included, turnaround and rounds of changes. */
export function DesignServicesPage() {
  const { catalog } = useCatalog();
  const saver = useSaver();
  if (!catalog) return <p className="page-loading">Loading…</p>;

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>Design services</h1>
          <p className="muted">
            Packages customers can buy instead of designing the card themselves. The fee is added once per card design. Hidden packages
            disappear from the storefront; orders already placed keep the package they bought.
          </p>
        </div>
      </header>

      {catalog.designServices.map((tier) => (
        <TierForm
          key={`${tier.code}-${tier.sortOrder}-${JSON.stringify(tier)}`}
          tier={tier}
          busy={saver.saving}
          onSave={(patch) => saver.save(() => api(`${productPath}/design-services/${tier.code}`, { method: 'PATCH', body: patch }), `${patch.name ?? tier.name} saved`)}
        />
      ))}
      {catalog.designServices.length === 0 && <p className="empty-note">No design packages for this product.</p>}
      <Toast status={saver.status} onClose={saver.clearStatus} />
    </div>
  );
}

function TierForm({ tier, busy, onSave }: { tier: AdminDesignService; busy: boolean; onSave: (patch: Partial<AdminDesignService>) => Promise<boolean> }) {
  const [name, setName] = useState(tier.name);
  const [price, setPrice] = useState((tier.priceCents / 100).toFixed(2));
  const [description, setDescription] = useState(tier.description ?? '');
  const [features, setFeatures] = useState(tier.features.join('\n'));
  const [designDays, setDesignDays] = useState(String(tier.designDays));
  const [revisions, setRevisions] = useState(tier.revisions === null ? '' : String(tier.revisions));
  const [isActive, setIsActive] = useState(tier.isActive);
  const [error, setError] = useState<string | null>(null);

  function submit(event: FormEvent) {
    event.preventDefault();
    const priceCents = Math.round(Number(price) * 100);
    const days = Number(designDays);
    const rounds = revisions.trim() === '' ? null : Number(revisions);
    if (!Number.isFinite(priceCents) || priceCents < 0) return setError('Enter a price of $0.00 or more.');
    if (!Number.isInteger(days) || days < 1 || days > 60) return setError('First draft must be 1 to 60 business days.');
    if (rounds !== null && (!Number.isInteger(rounds) || rounds < 0)) return setError('Rounds of changes must be a whole number, or empty for unlimited.');
    setError(null);
    void onSave({
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
    <form className="card card-pad" onSubmit={submit}>
      <div className="value-summary">
        <div className="value-main">
          <div className="value-label">
            {tier.name} · {money(tier.priceCents)}
            {!tier.isActive && <span className="badge">Hidden</span>}
          </div>
          <span className="value-code">Code: {tier.code}</span>
        </div>
      </div>
      <div className="form-grid" style={{ marginTop: 12 }}>
        <label className="field">
          <span>Name</span>
          <input value={name} maxLength={60} required onChange={(e) => setName(e.target.value)} />
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
      </label>
      <label className="check" style={{ marginTop: 12 }}>
        <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
        Offered on the storefront
      </label>
      {error && <p className="form-error">{error}</p>}
      <div className="form-actions">
        <button type="submit" className="btn btn-primary" disabled={busy}>
          Save {tier.name}
        </button>
      </div>
    </form>
  );
}
