import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { api, type LibraryGroup } from '../api';
import { useCatalog, useSaver, type RegisterSave } from '../catalog';
import { Toast } from '../components/Toast';
import { AddLibraryQuantity, AddLibraryValue } from './OptionsPage';

type Saver = ReturnType<typeof useSaver>;

/** Quantities are not an option group, so their tab sits after the groups. */
const QUANTITY_TAB = 'quantity';

/** What a product offers, out of the option library. */
export function ProductOptionsPage() {
  const { catalog, library } = useCatalog();
  const [groupCode, setGroupCode] = useState('size');
  const saver = useSaver();

  if (!catalog || library.length === 0) return <p className="page-loading">Loading…</p>;
  const group = library.find((g) => g.code === groupCode) ?? library[0]!;
  const showQuantities = groupCode === QUANTITY_TAB;
  const usedCount = (code: string) => catalog.groups.find((g) => g.code === code)?.values.filter((v) => v.isActive).length ?? 0;

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>Options</h1>
          <p className="muted">
            Tick what this product offers. Names and details are shared and edited in the <Link to="/options">Option library</Link>.
          </p>
        </div>
      </header>

      <div className="tabs">
        {library.map((g) => (
          <button key={g.code} type="button" className={`tab ${!showQuantities && g.code === group.code ? 'tab-active' : ''}`} onClick={() => setGroupCode(g.code)}>
            {g.label}
            <span className="tab-count">{usedCount(g.code)}</span>
          </button>
        ))}
        <button type="button" className={`tab ${showQuantities ? 'tab-active' : ''}`} onClick={() => setGroupCode(QUANTITY_TAB)}>
          Quantity
          <span className="tab-count">{catalog.quantityTiers.filter((t) => t.isActive).length}</span>
        </button>
      </div>

      {showQuantities ? <QuantityPicker saver={saver} /> : <OptionPicker key={group.code} group={group} saver={saver} />}

      <Toast status={saver.status} onClose={saver.clearStatus} />
    </div>
  );
}

interface Pick {
  isActive: boolean;
  /** Text while it is typed; add-ons only. */
  percent: string;
}

/**
 * Every option of a library group, ticked when the product uses it, and a form for a new one. Ticking only
 * changes this page: it is saved by the Save button, or with `register` when the wizard goes on.
 */
export function OptionPicker({
  group,
  saver,
  title,
  percent = false,
  register,
  onPicked,
}: {
  group: LibraryGroup;
  saver: Saver;
  title?: string;
  /** Add-ons in the wizard: the percent is entered next to the option. */
  percent?: boolean;
  register?: RegisterSave;
  onPicked?: (codes: string[]) => void;
}) {
  const { catalog, path } = useCatalog();
  const used = useMemo(() => catalog?.groups.find((g) => g.code === group.code)?.values ?? [], [catalog, group.code]);
  const saved = useMemo(() => Object.fromEntries(used.map((v) => [v.code, { isActive: v.isActive, percent: String(v.addonPercent) }])), [used]);
  const savedDefault = used.find((v) => v.isDefault)?.code ?? null;
  const [picks, setPicks] = useState<Record<string, Pick>>(saved);
  const [defaultCode, setDefaultCode] = useState<string | null>(savedDefault);

  // Start again from what is saved, but not when only the library changed (a new option was just added).
  const signature = JSON.stringify([saved, savedDefault]);
  useEffect(() => {
    setPicks(saved);
    setDefaultCode(savedDefault);
  }, [signature]);

  const codes = group.values.map((v) => v.code).filter((code) => picks[code]);
  useEffect(() => onPicked?.(codes), [codes.join()]);

  const dirty = JSON.stringify([sorted(picks), defaultCode]) !== JSON.stringify([sorted(saved), savedDefault]);
  const invalidPercent = codes.some((code) => !Number.isFinite(Number(picks[code]!.percent)) || picks[code]!.percent.trim() === '');

  function toggle(code: string) {
    const { [code]: was, ...rest } = picks;
    const next = was ? rest : { ...picks, [code]: saved[code] ?? { isActive: true, percent: '0' } };
    setPicks(next);
    if (!defaultCode || (was && defaultCode === code)) setDefaultCode(group.values.find((v) => next[v.code]?.isActive)?.code ?? null);
  }

  const save = () =>
    saver.save(
      () =>
        api(`${path}/groups/${group.code}/values`, {
          method: 'PUT',
          body: {
            values: codes.map((code) => ({ code, isActive: picks[code]!.isActive, ...(percent ? { addonPercent: Number(picks[code]!.percent) } : {}) })),
            ...(defaultCode ? { default: defaultCode } : {}),
          },
        }),
      `${group.label} saved`,
    );
  useEffect(() => register?.(`options.${group.code}`, async () => (!dirty ? true : invalidPercent ? false : save())));

  const removed = used.filter((v) => !picks[v.code]).map((v) => v.label);

  return (
    <div className="card">
      {title && (
        <div className="value-row">
          <div className="value-summary">
            <div className="value-label">{title}</div>
          </div>
        </div>
      )}
      {group.values.map((value) => {
        const pick = picks[value.code];
        const isDefault = defaultCode === value.code;
        return (
          <div key={value.code} className={`value-row ${pick && !pick.isActive ? 'value-hidden' : ''}`}>
            <div className="value-summary">
              <input type="checkbox" className="pick-check" checked={Boolean(pick)} aria-label={`Offer ${value.label}`} onChange={() => toggle(value.code)} />
              <div className="value-main">
                <div className="value-label">
                  {value.label}
                  {pick && isDefault && <span className="badge badge-default">Default</span>}
                  {pick && !pick.isActive && <span className="badge">Hidden</span>}
                </div>
                {value.description && <span className="value-code">{value.description}</span>}
              </div>
              {pick && (
                <div className="value-actions">
                  {percent && (
                    <span className="addon-percent">
                      <input
                        className="money"
                        inputMode="decimal"
                        value={pick.percent}
                        aria-label={`${value.label} percent`}
                        onChange={(e) => setPicks({ ...picks, [value.code]: { ...pick, percent: e.target.value } })}
                      />
                      <span>%</span>
                    </span>
                  )}
                  {!isDefault && pick.isActive && (
                    <button type="button" className="btn btn-small" onClick={() => setDefaultCode(value.code)}>
                      Make default
                    </button>
                  )}
                  {!isDefault && (
                    <button type="button" className="btn btn-small" onClick={() => setPicks({ ...picks, [value.code]: { ...pick, isActive: !pick.isActive } })}>
                      {pick.isActive ? 'Hide' : 'Show'}
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        );
      })}
      <AddLibraryValue key={group.code} group={group} saver={saver} onAdded={(code) => setPicks((all) => ({ ...all, [code]: { isActive: true, percent: '0' } }))} />
      {!register && dirty && (
        <div className="value-row save-row">
          {removed.length > 0 && <p className="muted">Saving removes the prices and rules of {removed.join(', ')} on this product.</p>}
          <div className="form-actions">
            <button type="button" className="btn btn-primary" disabled={saver.saving || invalidPercent} onClick={() => void save()}>
              Save changes
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                setPicks(saved);
                setDefaultCode(savedDefault);
              }}
            >
              Discard
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** The library quantities, ticked when the product sells them. Saved like `OptionPicker`. */
export function QuantityPicker({ saver, register }: { saver: Saver; register?: RegisterSave }) {
  const { catalog, libraryQuantities, path } = useCatalog();
  const tiers = useMemo(() => catalog?.quantityTiers ?? [], [catalog]);
  const saved = useMemo(() => Object.fromEntries(tiers.map((t) => [t.quantity, t.isActive])) as Record<number, boolean>, [tiers]);
  const savedDefault = tiers.find((t) => t.isDefault)?.quantity ?? null;
  const [picks, setPicks] = useState<Record<number, boolean>>(saved);
  const [defaultQuantity, setDefaultQuantity] = useState<number | null>(savedDefault);

  const signature = JSON.stringify([saved, savedDefault]);
  useEffect(() => {
    setPicks(saved);
    setDefaultQuantity(savedDefault);
  }, [signature]);

  const dirty = JSON.stringify([picks, defaultQuantity]) !== signature;
  const numbers = libraryQuantities.map((q) => q.quantity).filter((q) => q in picks);

  function toggle(quantity: number) {
    const { [quantity]: was, ...rest } = picks;
    const next: Record<number, boolean> = was === undefined ? { ...picks, [quantity]: saved[quantity] ?? true } : rest;
    setPicks(next);
    if (defaultQuantity === null || (was !== undefined && defaultQuantity === quantity)) {
      setDefaultQuantity(libraryQuantities.map((q) => q.quantity).find((q) => next[q]) ?? null);
    }
  }

  const save = () =>
    saver.save(
      () =>
        api(`${path}/quantities`, {
          method: 'PUT',
          body: { quantities: numbers.map((quantity) => ({ quantity, isActive: picks[quantity] })), ...(defaultQuantity ? { default: defaultQuantity } : {}) },
        }),
      'Quantities saved',
    );
  useEffect(() => register?.('options.quantity', async () => (dirty ? save() : true)));

  const removed = tiers.filter((t) => !(t.quantity in picks)).map((t) => t.quantity.toLocaleString('en-US'));

  return (
    <div className="card">
      {libraryQuantities.map(({ quantity }) => {
        const active = picks[quantity];
        const picked = active !== undefined;
        const isDefault = defaultQuantity === quantity;
        const priced = catalog?.corePrices.filter((p) => p.quantity === quantity).length ?? 0;
        return (
          <div key={quantity} className={`value-row ${picked && !active ? 'value-hidden' : ''}`}>
            <div className="value-summary">
              <input type="checkbox" className="pick-check" checked={picked} aria-label={`Sell ${quantity}`} onChange={() => toggle(quantity)} />
              <div className="value-main">
                <div className="value-label">
                  {quantity.toLocaleString('en-US')}
                  {picked && isDefault && <span className="badge badge-default">Default</span>}
                  {picked && !active && <span className="badge">Hidden</span>}
                  {!register && picked && quantity in saved && priced === 0 && <span className="badge badge-rule">No prices yet</span>}
                </div>
              </div>
              {picked && (
                <div className="value-actions">
                  {!isDefault && active && (
                    <button type="button" className="btn btn-small" onClick={() => setDefaultQuantity(quantity)}>
                      Make default
                    </button>
                  )}
                  {!isDefault && (
                    <button type="button" className="btn btn-small" onClick={() => setPicks({ ...picks, [quantity]: !active })}>
                      {active ? 'Hide' : 'Show'}
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        );
      })}
      <AddLibraryQuantity saver={saver} onAdded={(quantity) => setPicks((all) => ({ ...all, [quantity]: true }))} />
      {!register && dirty && (
        <div className="value-row save-row">
          {removed.length > 0 && <p className="muted">Saving removes the prices and turnaround of {removed.join(', ')} on this product.</p>}
          <div className="form-actions">
            <button type="button" className="btn btn-primary" disabled={saver.saving} onClick={() => void save()}>
              Save changes
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                setPicks(saved);
                setDefaultQuantity(savedDefault);
              }}
            >
              Discard
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const sorted = (picks: Record<string, Pick>) => Object.entries(picks).sort(([a], [b]) => a.localeCompare(b));
