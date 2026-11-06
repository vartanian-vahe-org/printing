import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { api, type LibraryDesignService } from '../api';
import { dollars, parseDollars, useCatalog, useSaver, type RegisterSave } from '../catalog';
import { Toast } from '../components/Toast';
import { money } from '../orders';

type Saver = ReturnType<typeof useSaver>;
type TierFields = Omit<LibraryDesignService, 'code' | 'sortOrder' | 'usedBy'>;

/** Product tab: which library packages this product offers. */
export function DesignServicesPage() {
  const saver = useSaver();

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>Design services</h1>
          <p className="muted">
            Tick the packages customers can buy for this product. What each includes is shared and edited in the <Link to="/options">Option library</Link>;
            the name customers see and the price are set here.
          </p>
        </div>
      </header>
      <DesignServicePicker saver={saver} />
      <Toast status={saver.status} onClose={saver.clearStatus} />
    </div>
  );
}

interface Pick {
  displayName: string;
  price: string;
  isActive: boolean;
}

/** The library packages, ticked when the product offers them. Saved like the option picker. */
export function DesignServicePicker({ saver, register }: { saver: Saver; register?: RegisterSave }) {
  const { catalog, libraryDesignServices, path } = useCatalog();
  const used = useMemo(() => catalog?.designServices ?? [], [catalog]);
  const saved = useMemo(
    () => Object.fromEntries(used.map((d) => [d.code, { displayName: d.displayName ?? '', price: dollars(d.priceCents), isActive: d.isActive }])) as Record<string, Pick>,
    [used],
  );
  const [picks, setPicks] = useState<Record<string, Pick>>(saved);

  const signature = JSON.stringify(sorted(saved));
  useEffect(() => setPicks(saved), [signature]);

  const dirty = JSON.stringify(sorted(picks)) !== signature;
  const codes = libraryDesignServices.map((d) => d.code).filter((code) => picks[code]);
  const invalid = codes.some((code) => (parseDollars(picks[code]!.price) ?? -1) < 0);

  const save = () =>
    saver.save(
      () =>
        api(`${path}/design-services`, {
          method: 'PUT',
          body: {
            services: codes.map((code) => ({
              code,
              displayName: picks[code]!.displayName.trim() || null,
              priceCents: parseDollars(picks[code]!.price),
              isActive: picks[code]!.isActive,
            })),
          },
        }),
      'Design services saved',
    );
  useEffect(() => register?.('options.design', async () => (!dirty ? true : invalid ? false : save())));

  const change = (code: string, patch: Partial<Pick>) => setPicks({ ...picks, [code]: { ...picks[code]!, ...patch } });

  return (
    <div className="card">
      {libraryDesignServices.map((service) => {
        const pick = picks[service.code];
        return (
          <div key={service.code} className={`value-row ${pick && !pick.isActive ? 'value-hidden' : ''}`}>
            <div className="value-summary">
              <input
                type="checkbox"
                className="pick-check"
                checked={Boolean(pick)}
                aria-label={`Offer ${service.name}`}
                onChange={() => {
                  if (pick) {
                    const { [service.code]: _removed, ...rest } = picks;
                    setPicks(rest);
                  } else {
                    setPicks({ ...picks, [service.code]: saved[service.code] ?? { displayName: '', price: dollars(service.priceCents), isActive: true } });
                  }
                }}
              />
              <div className="value-main">
                <div className="value-label">
                  {service.name}
                  {pick && !pick.isActive && <span className="badge">Hidden</span>}
                </div>
                <span className="value-code">{summary(service)}</span>
              </div>
              {pick && (
                <div className="value-actions">
                  <button type="button" className="btn btn-small" onClick={() => change(service.code, { isActive: !pick.isActive })}>
                    {pick.isActive ? 'Hide' : 'Show'}
                  </button>
                </div>
              )}
            </div>
            {pick && (
              <div className="form-grid design-pick">
                <label className="field">
                  <span>Name on this product</span>
                  <input value={pick.displayName} maxLength={60} placeholder={service.name} onChange={(e) => change(service.code, { displayName: e.target.value })} />
                </label>
                <label className="field">
                  <span>Price on this product (USD)</span>
                  <input inputMode="decimal" value={pick.price} aria-invalid={(parseDollars(pick.price) ?? -1) < 0 || undefined} onChange={(e) => change(service.code, { price: e.target.value })} />
                </label>
              </div>
            )}
          </div>
        );
      })}
      {libraryDesignServices.length === 0 && (
        <p className="value-row muted">
          No packages yet. Add them in the <Link to="/options">Option library</Link>.
        </p>
      )}
      {!register && dirty && (
        <div className="value-row save-row">
          <div className="form-actions">
            <button type="button" className="btn btn-primary" disabled={saver.saving || invalid} onClick={() => void save()}>
              Save changes
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setPicks(saved)}>
              Discard
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const sorted = (picks: Record<string, Pick>) => Object.entries(picks).sort(([a], [b]) => a.localeCompare(b));

function revisionsText(revisions: number | null): string {
  return revisions === null ? 'unlimited changes' : `${revisions} round${revisions === 1 ? '' : 's'} of changes`;
}

function summary(service: LibraryDesignService): string {
  return `First draft in ${service.designDays} business day${service.designDays === 1 ? '' : 's'} · ${revisionsText(service.revisions)}`;
}

/** Option library tab: the packages themselves, with their standard names. */
export function LibraryDesignServices({ saver }: { saver: Saver }) {
  const { libraryDesignServices: tiers } = useCatalog();
  const [adding, setAdding] = useState(false);

  return (
    <div className="card">
      {tiers.map((tier, index) => (
        <TierRow key={`${tier.code}-${JSON.stringify(tier)}`} tier={tier} neighbours={[tiers[index - 1], tiers[index + 1]]} saver={saver} />
      ))}
      <div className="value-row value-add">
        {adding ? (
          <TierForm
            title="New package"
            // Starts from the last package's details so a new one only needs what is different.
            initial={{ ...(tiers.at(-1) ?? { description: null, priceCents: 0, features: [], designDays: 1, revisions: null }), name: '' }}
            submitText="Add package"
            busy={saver.saving}
            onCancel={() => setAdding(false)}
            onSubmit={async (fields) => {
              const ok = await saver.save(() => api('/admin/options/design-services', { method: 'POST', body: fields }), `${fields.name} added`);
              if (ok) setAdding(false);
            }}
          />
        ) : (
          <button type="button" className="btn btn-small" onClick={() => setAdding(true)}>
            + New package
          </button>
        )}
      </div>
    </div>
  );
}

function TierRow({
  tier,
  neighbours,
  saver,
}: {
  tier: LibraryDesignService;
  neighbours: [LibraryDesignService | undefined, LibraryDesignService | undefined];
  saver: Saver;
}) {
  const [open, setOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const path = `/admin/options/design-services/${tier.code}`;

  async function move(direction: -1 | 1) {
    const other = neighbours[direction === -1 ? 0 : 1];
    if (!other) return;
    await saver.save(async () => {
      await api(path, { method: 'PATCH', body: { sortOrder: other.sortOrder } });
      await api(`/admin/options/design-services/${other.code}`, { method: 'PATCH', body: { sortOrder: tier.sortOrder } });
    }, 'Order updated');
  }

  return (
    <div className="value-row">
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
          </div>
          <span className="muted">
            {summary(tier)}
            {tier.description ? ` · ${tier.description}` : ''}
          </span>
          <span className="value-code">{tier.usedBy.length ? `Used by ${tier.usedBy.join(', ')}` : 'Not used by any product yet'}</span>
        </div>
        <div className="value-actions">
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
            usedBy={tier.usedBy}
            onCancel={() => setOpen(false)}
            onDelete={() => setConfirmDelete(true)}
            onSubmit={async (fields) => {
              if (await saver.save(() => api(path, { method: 'PATCH', body: fields }), `${fields.name} saved`)) setOpen(false);
            }}
          />
          {confirmDelete && (
            <div className="confirm-box" role="alert">
              <p>
                Delete the <strong>{tier.name}</strong> package from the library?
              </p>
              <div className="form-actions">
                <button type="button" className="btn btn-danger" disabled={saver.saving} onClick={() => void saver.save(() => api(path, { method: 'DELETE' }), `${tier.name} deleted`)}>
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
  usedBy?: string[];
  onSubmit: (fields: TierFields) => Promise<void>;
  onCancel: () => void;
  onDelete?: () => void;
}) {
  const { title, initial, submitText, busy, usedBy = [], onSubmit, onCancel, onDelete } = props;
  const [name, setName] = useState(initial.name);
  const [price, setPrice] = useState((initial.priceCents / 100).toFixed(2));
  const [description, setDescription] = useState(initial.description ?? '');
  const [features, setFeatures] = useState(initial.features.join('\n'));
  const [designDays, setDesignDays] = useState(String(initial.designDays));
  const [revisions, setRevisions] = useState(initial.revisions === null ? '' : String(initial.revisions));
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
    });
  }

  return (
    <form className={`value-form ${title ? 'value-form-new' : ''}`} onSubmit={submit}>
      {title && <h3 className="form-subtitle">{title}</h3>}
      <div className="form-grid">
        <label className="field">
          <span>Standard name</span>
          <input value={name} maxLength={60} required onChange={(e) => setName(e.target.value)} autoFocus={Boolean(title)} />
        </label>
        <label className="field">
          <span>Suggested price (USD)</span>
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
      {usedBy.length > 0 && <p className="muted">This changes it on {usedBy.join(', ')}. Their own names and prices stay.</p>}
      {error && <p className="form-error">{error}</p>}
      <div className="form-actions">
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {submitText}
        </button>
        <button type="button" className="btn btn-ghost" onClick={onCancel}>
          Cancel
        </button>
        {onDelete &&
          (usedBy.length ? (
            <>
              <span className="form-actions-spacer" />
              <span className="muted">Remove it from {usedBy.join(', ')} before deleting it.</span>
            </>
          ) : (
            <>
              <span className="form-actions-spacer" />
              <button type="button" className="btn btn-ghost btn-danger-text" onClick={onDelete}>
                Delete package
              </button>
            </>
          ))}
      </div>
    </form>
  );
}
