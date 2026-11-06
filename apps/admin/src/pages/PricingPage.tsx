import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { api, type AdminCatalog, type AdminValue } from '../api';
import { dollars, parseDollars, useCatalog, useSaver } from '../catalog';
import { Toast } from '../components/Toast';

type Grid = Record<string, string>;
const CORE_GROUPS = ['size', 'paper', 'printed_side'];
/** Options priced by a percent here; turnaround has its own table (Turnaround page). */
const isAddon = (group: string) => !CORE_GROUPS.includes(group) && group !== 'turnaround';
const coreCell = (size: string, paper: string, printedSide: string, quantity: number) => `${size}|${paper}|${printedSide}|${quantity}`;
const addonCell = (group: string, value: string) => `${group}|${value}`;

function initialGrid(catalog: AdminCatalog): { core: Grid; addons: Grid } {
  const core: Grid = {};
  for (const p of catalog.corePrices) core[coreCell(p.size, p.paper, p.printedSide, p.quantity)] = dollars(p.priceCents);
  const addons: Grid = {};
  for (const group of catalog.groups) {
    if (!isAddon(group.code)) continue;
    for (const value of group.values) addons[addonCell(group.code, value.code)] = String(value.addonPercent);
  }
  return { core, addons };
}

/** Empty = not sold at that quantity. */
const validPrice = (text: string) => text.trim() === '' || (parseDollars(text) ?? 0) > 0;

function validPercent(text: string) {
  const percent = Number(text);
  return text.trim() !== '' && Number.isFinite(percent) && percent >= -90 && percent <= 500 && Math.abs(Math.round(percent * 100) - percent * 100) < 1e-6;
}

export function PricingPage() {
  const { product } = useCatalog();
  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>Prices</h1>
          <p className="muted">
            Each combination of size, paper and printed sides has its own price per quantity, in US dollars. Add-ons then add a percent of that
            price, and the speed its percent from the <Link to={`/products/${product?.code}/turnaround`}>Turnaround</Link> tab.
          </p>
        </div>
      </header>
      <PricingEditor />
    </div>
  );
}

/** The price tables and their Save button; `onDirty` tells a page around it about unsaved changes. */
export function PricingEditor({ show = 'all', onDirty }: { show?: 'all' | 'core' | 'addons'; onDirty?: (dirty: boolean) => void }) {
  const { catalog, path: productPath } = useCatalog();
  const saver = useSaver();
  const initial = useMemo(() => (catalog ? initialGrid(catalog) : null), [catalog]);
  const [core, setCore] = useState<Grid>({});
  const [addons, setAddons] = useState<Grid>({});
  useEffect(() => {
    if (initial) {
      setCore(initial.core);
      setAddons(initial.addons);
    }
  }, [initial]);

  const changedCore = initial ? Object.keys(core).filter((k) => core[k]!.trim() !== (initial.core[k] ?? '')) : [];
  const changedAddons = initial ? Object.keys(addons).filter((k) => Number(addons[k]) !== Number(initial.addons[k]) || addons[k]!.trim() === '') : [];
  const changes = changedCore.length + changedAddons.length;
  useEffect(() => onDirty?.(changes > 0), [changes, onDirty]);

  if (!catalog || !initial) return <p className="page-loading">Loading…</p>;
  const tiers = catalog.quantityTiers;
  const valuesOf = (code: string) => catalog.groups.find((g) => g.code === code)?.values ?? [];
  const invalid = changedCore.some((k) => !validPrice(core[k]!)) || changedAddons.some((k) => !validPercent(addons[k]!));

  function save() {
    void saver.save(
      () =>
        api(`${productPath}/pricing`, {
          method: 'PUT',
          body: {
            corePrices: changedCore.map((key) => {
              const [size, paper, printedSide, quantity] = key.split('|');
              return { size, paper, printedSide, quantity: Number(quantity), priceCents: core[key]!.trim() === '' ? null : parseDollars(core[key]!) };
            }),
            addons: changedAddons.map((key) => {
              const [group, value] = key.split('|');
              return { group, value, percent: Number(addons[key]) };
            }),
          },
        }),
      `Saved ${changes} price${changes === 1 ? '' : 's'}`,
    );
  }

  const setTier = (quantity: number, body: Record<string, unknown>, text: string) =>
    saver.save(() => api(`${productPath}/pricing`, { method: 'PUT', body: { tiers: [{ quantity, ...body }] } }), text);

  const hidden = (...values: AdminValue[]) => (values.some((v) => !v.isActive) ? 'row-hidden' : '');

  const addonGroups = catalog.groups.filter((g) => isAddon(g.code));

  return (
    <>
      <div className="header-actions editor-actions">
        {changes > 0 && (
          <button type="button" className="btn btn-ghost" onClick={() => (setCore(initial.core), setAddons(initial.addons))}>
            Discard
          </button>
        )}
        <button type="button" className="btn btn-primary" disabled={changes === 0 || invalid || saver.saving} onClick={save}>
          {changes > 0 ? `Save changes (${changes})` : 'No changes'}
        </button>
      </div>
      {invalid && <div className="banner banner-error">Some amounts are not valid. Use e.g. 26.60 for a price and 15 for a percent.</div>}

      {show !== 'addons' && <section className="card price-section">
        <h2>Core prices</h2>
        <p className="muted">Leave a cell empty if that combination is not sold at that quantity.</p>
        <div className="table-scroll">
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
              {valuesOf('size').map((size) => (
                <SizeRows
                  key={size.code}
                  size={size}
                  papers={valuesOf('paper')}
                  sides={valuesOf('printed_side')}
                  tiers={tiers}
                  core={core}
                  initial={initial.core}
                  hidden={hidden}
                  setCore={setCore}
                />
              ))}
            </tbody>
          </table>
        </div>
      </section>}

      {show !== 'core' && addonGroups.length > 0 && <section className="card price-section">
        <h2>Add-ons</h2>
        <p className="muted">Percent of the core price, the same at every quantity. Use a negative percent for a discount.</p>
        <table className="price-table addon-table">
          <tbody>
            {addonGroups.map((group) => (
              <AddonRows key={group.code} group={group} addons={addons} initial={initial.addons} setAddons={setAddons} />
            ))}
          </tbody>
        </table>
      </section>}

      <Toast status={saver.status} onClose={saver.clearStatus} />
    </>
  );
}

function SizeRows({
  size,
  papers,
  sides,
  tiers,
  core,
  initial,
  hidden,
  setCore,
}: {
  size: AdminValue;
  papers: AdminValue[];
  sides: AdminValue[];
  tiers: AdminCatalog['quantityTiers'];
  core: Grid;
  initial: Grid;
  hidden: (...values: AdminValue[]) => string;
  setCore: (update: (grid: Grid) => Grid) => void;
}) {
  return (
    <>
      <tr className="row-group">
        <th colSpan={tiers.length + 1}>{size.label}</th>
      </tr>
      {papers.flatMap((paper) =>
        sides.map((side) => (
          <tr key={`${paper.code}|${side.code}`} className={hidden(size, paper, side)}>
            <th className="row-label">
              {paper.label} · {side.label}
            </th>
            {tiers.map((t) => {
              const key = coreCell(size.code, paper.code, side.code, t.quantity);
              const value = core[key] ?? '';
              return (
                <td key={t.quantity}>
                  <AmountInput
                    value={value}
                    changed={value.trim() !== (initial[key] ?? '')}
                    valid={validPrice(value)}
                    onChange={(v) => setCore((grid) => ({ ...grid, [key]: v }))}
                  />
                </td>
              );
            })}
          </tr>
        )),
      )}
    </>
  );
}

function AddonRows({
  group,
  addons,
  initial,
  setAddons,
}: {
  group: AdminCatalog['groups'][number];
  addons: Grid;
  initial: Grid;
  setAddons: (update: (grid: Grid) => Grid) => void;
}) {
  return (
    <>
      <tr className="row-group">
        <th colSpan={2}>{group.label}</th>
      </tr>
      {group.values.map((value) => {
        const key = addonCell(group.code, value.code);
        const text = addons[key] ?? '';
        return (
          <tr key={value.code} className={value.isActive ? '' : 'row-hidden'}>
            <th className="row-label">
              {value.label}
              {value.isDefault && <span className="badge badge-default">Default</span>}
            </th>
            <td className="addon-percent">
              <AmountInput
                value={text}
                changed={Number(text) !== Number(initial[key])}
                valid={validPercent(text)}
                onChange={(v) => setAddons((grid) => ({ ...grid, [key]: v }))}
              />
              <span>%</span>
            </td>
          </tr>
        );
      })}
    </>
  );
}

function AmountInput({ value, changed, valid, onChange }: { value: string; changed: boolean; valid: boolean; onChange: (value: string) => void }) {
  return (
    <input
      className={`money ${changed ? 'money-changed' : ''} ${valid ? '' : 'money-invalid'}`}
      inputMode="decimal"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-invalid={!valid || undefined}
    />
  );
}
