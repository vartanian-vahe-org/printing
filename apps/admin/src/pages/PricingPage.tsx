import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { api, type AdminCatalog, type AdminValue } from '../api';
import { dollars, parseDollars, useCatalog, useSaver, type RegisterSave } from '../catalog';
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

/** The price tables. `register`: the setup wizard saves them on Next, so they show no Save button. */
export function PricingEditor({ show = 'all', register }: { show?: 'all' | 'core' | 'addons'; register?: RegisterSave }) {
  const { catalog, path: productPath } = useCatalog();
  const saver = useSaver();
  const initial = useMemo(() => (catalog ? initialGrid(catalog) : null), [catalog]);
  const [core, setCore] = useState<Grid>({});
  const [addons, setAddons] = useState<Grid>({});
  const [sizeCode, setSizeCode] = useState('');
  const [paperCode, setPaperCode] = useState('');
  const [addonCode, setAddonCode] = useState('');
  useEffect(() => {
    if (initial) {
      setCore(initial.core);
      setAddons(initial.addons);
    }
  }, [initial]);

  const changedCore = initial ? Object.keys(core).filter((k) => core[k]!.trim() !== (initial.core[k] ?? '')) : [];
  const changedAddons = initial ? Object.keys(addons).filter((k) => Number(addons[k]) !== Number(initial.addons[k]) || addons[k]!.trim() === '') : [];
  const changes = changedCore.length + changedAddons.length;
  const invalid = changedCore.some((k) => !validPrice(core[k]!)) || changedAddons.some((k) => !validPercent(addons[k]!));
  useEffect(() => register?.('prices', async () => (changes === 0 ? true : invalid ? false : save())));

  if (!catalog || !initial) return <p className="page-loading">Loading…</p>;
  const tiers = catalog.quantityTiers;
  const valuesOf = (code: string) => catalog.groups.find((g) => g.code === code)?.values ?? [];

  function save() {
    return saver.save(
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

  const hidden = (...values: AdminValue[]) => (values.some((v) => !v.isActive) ? 'row-hidden' : '');
  const sizes = valuesOf('size');
  const papers = valuesOf('paper');
  const sides = valuesOf('printed_side');
  const size = sizes.find((v) => v.code === sizeCode) ?? sizes[0];
  const paper = papers.find((v) => v.code === paperCode) ?? papers[0];
  /** "12/24": prices entered out of the cells of these sizes and papers. */
  const filled = (sizeList: AdminValue[], paperList: AdminValue[]) => {
    const cells = sizeList.flatMap((a) => paperList.flatMap((b) => sides.flatMap((c) => tiers.map((t) => core[coreCell(a.code, b.code, c.code, t.quantity)] ?? ''))));
    return `${cells.filter((text) => text.trim() !== '').length}/${cells.length}`;
  };

  const addonGroups = catalog.groups.filter((g) => isAddon(g.code));
  const addonGroup = addonGroups.find((g) => g.code === addonCode) ?? addonGroups[0];

  return (
    <>
      {!register && (
        <div className="header-actions editor-actions">
          {changes > 0 && (
            <button type="button" className="btn btn-ghost" onClick={() => (setCore(initial.core), setAddons(initial.addons))}>
              Discard
            </button>
          )}
          <button type="button" className="btn btn-primary" disabled={changes === 0 || invalid || saver.saving} onClick={() => void save()}>
            {changes > 0 ? `Save changes (${changes})` : 'No changes'}
          </button>
        </div>
      )}
      {invalid && <div className="banner banner-error">Some amounts are not valid. Use e.g. 26.60 for a price and 15 for a percent.</div>}

      {show !== 'addons' && <section className="card price-section">
        <h2>Core prices</h2>
        <p className="muted">Pick a size and a paper, then enter a price per printed side and quantity. Leave a cell empty if it is not sold.</p>
        <PriceTabs title="Size" values={sizes} current={size?.code} onPick={setSizeCode} count={(v) => filled([v], papers)} />
        <PriceTabs title="Paper" values={papers} current={paper?.code} onPick={setPaperCode} count={(v) => (size ? filled([size], [v]) : '')} />
        {size && paper && (
          <div className="table-scroll">
            <table className="price-table">
              <thead>
                <tr>
                  <th>Printed side</th>
                  {tiers.map((t) => (
                    <th key={t.quantity} className={t.isActive ? '' : 'col-hidden'}>
                      {t.quantity.toLocaleString('en-US')}
                      {t.isDefault && <span className="badge badge-default">Default</span>}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sides.map((side) => (
                  <tr key={side.code} className={hidden(size, paper, side)}>
                    <th className="row-label">{side.label}</th>
                    {tiers.map((t) => {
                      const key = coreCell(size.code, paper.code, side.code, t.quantity);
                      const value = core[key] ?? '';
                      return (
                        <td key={t.quantity}>
                          <AmountInput
                            value={value}
                            changed={value.trim() !== (initial.core[key] ?? '')}
                            valid={validPrice(value)}
                            onChange={(v) => setCore((grid) => ({ ...grid, [key]: v }))}
                          />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>}

      {show !== 'core' && addonGroups.length > 0 && <section className="card price-section">
        <h2>Add-ons</h2>
        <p className="muted">Percent of the core price, the same at every quantity. Use a negative percent for a discount.</p>
        <div className="tabs">
          {addonGroups.map((g) => (
            <button key={g.code} type="button" className={`tab ${g.code === addonGroup?.code ? 'tab-active' : ''}`} onClick={() => setAddonCode(g.code)}>
              {g.label}
              <span className="tab-count">{g.values.length}</span>
            </button>
          ))}
        </div>
        {addonGroup && (
          <table className="price-table addon-table">
            <tbody>
              <AddonRows group={addonGroup} addons={addons} initial={initial.addons} setAddons={setAddons} />
            </tbody>
          </table>
        )}
      </section>}

      <Toast status={saver.status} onClose={saver.clearStatus} />
    </>
  );
}

/** A labelled row of tabs, like the option tabs: which size or paper the table below shows. */
function PriceTabs({
  title,
  values,
  current,
  onPick,
  count,
}: {
  title: string;
  values: AdminValue[];
  current: string | undefined;
  onPick: (code: string) => void;
  count: (value: AdminValue) => string;
}) {
  return (
    <div className="price-tabs">
      <span className="price-tabs-title">{title}</span>
      <div className="tabs">
        {values.map((value) => (
          <button key={value.code} type="button" className={`tab ${value.code === current ? 'tab-active' : ''}`} onClick={() => onPick(value.code)}>
            {value.label}
            {!value.isActive && ' (hidden)'}
            <span className="tab-count">{count(value)}</span>
          </button>
        ))}
      </div>
    </div>
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
