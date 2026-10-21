import { useEffect, useMemo, useState } from 'react';
import { api, productPath, type AdminCatalog } from '../api';
import { dollars, parseDollars, useCatalog, useSaver } from '../catalog';
import { Toast } from '../components/Toast';

type Grid = Record<string, string>;
const cell = (group: string, value: string, quantity: number) => `${group}.${value}.${quantity}`;

function initialGrid(catalog: AdminCatalog): { base: Grid; upcharge: Grid } {
  const base: Grid = {};
  for (const tier of catalog.quantityTiers) base[tier.quantity] = dollars(tier.basePriceCents);
  const upcharge: Grid = {};
  for (const group of catalog.groups) {
    if (group.code === 'size') continue;
    for (const value of group.values) {
      for (const tier of catalog.quantityTiers) {
        const found = catalog.upcharges.find((u) => u.group === group.code && u.value === value.code && u.quantity === tier.quantity);
        upcharge[cell(group.code, value.code, tier.quantity)] = dollars(found?.upchargeCents ?? 0);
      }
    }
  }
  return { base, upcharge };
}

export function PricingPage() {
  const { catalog } = useCatalog();
  const saver = useSaver();
  const initial = useMemo(() => (catalog ? initialGrid(catalog) : null), [catalog]);
  const [base, setBase] = useState<Grid>({});
  const [upcharge, setUpcharge] = useState<Grid>({});
  useEffect(() => {
    if (initial) {
      setBase(initial.base);
      setUpcharge(initial.upcharge);
    }
  }, [initial]);

  if (!catalog || !initial) return <p className="page-loading">Loading…</p>;
  const tiers = catalog.quantityTiers;

  const changedBase = Object.keys(base).filter((q) => base[q] !== initial.base[q]);
  const changedUpcharge = Object.keys(upcharge).filter((k) => upcharge[k] !== initial.upcharge[k]);
  const invalid = [...changedBase.map((q) => base[q]!), ...changedUpcharge.map((k) => upcharge[k]!)].some(
    (text) => parseDollars(text) === null,
  );
  const dirty = changedBase.length + changedUpcharge.length > 0;

  function save() {
    void saver.save(
      () =>
        api(`${productPath}/pricing`, {
          method: 'PUT',
          body: {
            tiers: changedBase.map((q) => ({ quantity: Number(q), basePriceCents: parseDollars(base[q]!)! })),
            upcharges: changedUpcharge.map((key) => {
              const [group, value, quantity] = key.split('.');
              return { group, value, quantity: Number(quantity), upchargeCents: parseDollars(upcharge[key]!)! };
            }),
          },
        }),
      `Saved ${changedBase.length + changedUpcharge.length} price${changedBase.length + changedUpcharge.length === 1 ? '' : 's'}`,
    );
  }

  const setTier = (quantity: number, body: Record<string, unknown>, text: string) =>
    saver.save(() => api(`${productPath}/pricing`, { method: 'PUT', body: { tiers: [{ quantity, ...body }] } }), text);

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>Pricing</h1>
          <p className="muted">
            Price = base price for the quantity + upcharge of each chosen option, then × size multiplier. Amounts in US dollars;
            upcharges can be negative.
          </p>
        </div>
        <div className="header-actions">
          {dirty && (
            <button type="button" className="btn btn-ghost" onClick={() => (setBase(initial.base), setUpcharge(initial.upcharge))}>
              Discard
            </button>
          )}
          <button type="button" className="btn btn-primary" disabled={!dirty || invalid || saver.saving} onClick={save}>
            {dirty ? `Save changes (${changedBase.length + changedUpcharge.length})` : 'No changes'}
          </button>
        </div>
      </header>
      {invalid && <div className="banner banner-error">Some amounts are not valid numbers (use e.g. 12.50).</div>}

      <div className="card table-scroll">
        <table className="price-table">
          <thead>
            <tr>
              <th>Quantity</th>
              {tiers.map((t) => (
                <th key={t.quantity} className={t.isActive ? '' : 'col-hidden'}>
                  {t.quantity.toLocaleString('en-US')}
                  {t.isDefault && <span className="badge badge-default">Default</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr className="row-base">
              <th>Base price</th>
              {tiers.map((t) => (
                <td key={t.quantity}>
                  <MoneyInput
                    value={base[t.quantity] ?? ''}
                    changed={base[t.quantity] !== initial.base[t.quantity]}
                    onChange={(v) => setBase({ ...base, [t.quantity]: v })}
                  />
                </td>
              ))}
            </tr>
            <tr>
              <th>Tier</th>
              {tiers.map((t) => (
                <td key={t.quantity} className="tier-actions">
                  {!t.isDefault && (
                    <button
                      type="button"
                      className="link-btn"
                      disabled={saver.saving}
                      onClick={() => void setTier(t.quantity, { isActive: !t.isActive }, t.isActive ? `${t.quantity} hidden` : `${t.quantity} shown`)}
                    >
                      {t.isActive ? 'Hide' : 'Show'}
                    </button>
                  )}
                  {!t.isDefault && t.isActive && (
                    <button
                      type="button"
                      className="link-btn"
                      disabled={saver.saving}
                      onClick={() => void setTier(t.quantity, { isDefault: true }, `Default quantity is now ${t.quantity}`)}
                    >
                      Default
                    </button>
                  )}
                </td>
              ))}
            </tr>
            {catalog.groups
              .filter((g) => g.code !== 'size')
              .map((group) => (
                <GroupRows key={group.code} group={group} tiers={tiers} upcharge={upcharge} initial={initial.upcharge} setUpcharge={setUpcharge} />
              ))}
          </tbody>
        </table>
      </div>

      <SizeMultipliers />
      <Toast status={saver.status} onClose={saver.clearStatus} />
    </div>
  );
}

function GroupRows({
  group,
  tiers,
  upcharge,
  initial,
  setUpcharge,
}: {
  group: AdminCatalog['groups'][number];
  tiers: AdminCatalog['quantityTiers'];
  upcharge: Grid;
  initial: Grid;
  setUpcharge: (grid: Grid) => void;
}) {
  return (
    <>
      <tr className="row-group">
        <th colSpan={tiers.length + 1}>{group.label}</th>
      </tr>
      {group.values.map((value) => (
        <tr key={value.code} className={value.isActive ? '' : 'row-hidden'}>
          <th className="row-label">
            {value.label}
            {value.isDefault && <span className="badge badge-default">Default</span>}
          </th>
          {tiers.map((t) => {
            const key = cell(group.code, value.code, t.quantity);
            return (
              <td key={t.quantity}>
                <MoneyInput value={upcharge[key] ?? ''} changed={upcharge[key] !== initial[key]} onChange={(v) => setUpcharge({ ...upcharge, [key]: v })} />
              </td>
            );
          })}
        </tr>
      ))}
    </>
  );
}

function MoneyInput({ value, changed, onChange }: { value: string; changed: boolean; onChange: (value: string) => void }) {
  const invalid = parseDollars(value) === null;
  return (
    <input
      className={`money ${changed ? 'money-changed' : ''} ${invalid ? 'money-invalid' : ''}`}
      inputMode="decimal"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-invalid={invalid || undefined}
    />
  );
}

/** Size uses a multiplier on the whole price instead of upcharges (spec §4.3). */
function SizeMultipliers() {
  const { catalog } = useCatalog();
  const saver = useSaver();
  const size = catalog!.groups.find((g) => g.code === 'size');
  const [draft, setDraft] = useState<Record<string, Record<string, string>>>({});
  if (!size) return null;

  const fields = (code: string) =>
    code === 'custom' ? ['fit_multiplier', 'area_multiplier'] : ['price_multiplier'];
  const label: Record<string, string> = {
    price_multiplier: 'Multiplier',
    fit_multiplier: 'Inside fits-in box',
    area_multiplier: 'Per sq in (outside box)',
  };

  return (
    <section className="card size-card">
      <h2>Size multipliers</h2>
      <p className="muted">The whole price is multiplied by this for each size. Custom size: inside the fits-in box use one multiplier, otherwise width × height × per-sq-in.</p>
      <div className="size-grid">
        {size.values.map((value) => (
          <form
            key={value.code}
            className="size-row"
            onSubmit={(e) => {
              e.preventDefault();
              const changes = draft[value.code] ?? {};
              const attributes = { ...value.attributes };
              for (const [k, v] of Object.entries(changes)) attributes[k] = Number(v);
              void saver
                .save(
                  () => api(`${productPath}/groups/size/values/${value.code}`, { method: 'PATCH', body: { attributes } }),
                  `${value.label} updated`,
                )
                .then((ok) => ok && setDraft({ ...draft, [value.code]: {} }));
            }}
          >
            <strong>{value.label}</strong>
            {fields(value.code).map((field) => (
              <label key={field} className="field field-compact">
                <span>{label[field]}</span>
                <input
                  type="number"
                  step="0.001"
                  min="0.001"
                  value={draft[value.code]?.[field] ?? String(value.attributes[field] ?? '')}
                  onChange={(e) => setDraft({ ...draft, [value.code]: { ...draft[value.code], [field]: e.target.value } })}
                />
              </label>
            ))}
            <button
              type="submit"
              className="btn btn-small"
              disabled={saver.saving || !Object.keys(draft[value.code] ?? {}).length}
            >
              Save
            </button>
          </form>
        ))}
      </div>
      <Toast status={saver.status} onClose={saver.clearStatus} />
    </section>
  );
}
