import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { api, type AdminCatalog } from '../api';
import { useCatalog, useSaver } from '../catalog';
import { Toast } from '../components/Toast';

const TURNAROUND = 'turnaround';

interface Cell {
  offered: boolean;
  days: string;
  percent: string;
}
type Table = Record<string, Cell>;
const key = (value: string, quantity: number) => `${value}@${quantity}`;

function initialTable(catalog: AdminCatalog): Table {
  const table: Table = {};
  const speeds = catalog.groups.find((g) => g.code === TURNAROUND)?.values ?? [];
  for (const speed of speeds) {
    for (const tier of catalog.quantityTiers) {
      const found = catalog.turnarounds.find((t) => t.value === speed.code && t.quantity === tier.quantity);
      table[key(speed.code, tier.quantity)] = found
        ? { offered: true, days: String(found.businessDays), percent: String(found.percent) }
        : { offered: false, days: '', percent: '' };
    }
  }
  return table;
}

function cellError(cell: Cell): string | null {
  if (!cell.offered) return null;
  const days = Number(cell.days);
  if (!Number.isInteger(days) || days < 1 || days > 60) return 'Days: a whole number from 1 to 60';
  const percent = Number(cell.percent);
  if (cell.percent.trim() === '' || !Number.isFinite(percent) || percent < -90 || percent > 500 || Math.abs(Math.round(percent * 100) - percent * 100) > 1e-6) {
    return 'Percent: from -90 to 500, at most 2 decimals';
  }
  return null;
}

const same = (a: Cell | undefined, b: Cell | undefined) =>
  a?.offered === b?.offered && (!a?.offered || (Number(a.days) === Number(b?.days) && Number(a.percent) === Number(b?.percent)));

/**
 * Quantity × speed table of the product picked in the sidebar: production days and a percent of the
 * printing price for each speed at each quantity. Speeds are added, renamed and hidden on the Options page.
 */
export function TurnaroundPage() {
  const { catalog, product, path: productPath } = useCatalog();
  const saver = useSaver();
  const initial = useMemo(() => (catalog ? initialTable(catalog) : null), [catalog]);
  const [table, setTable] = useState<Table>({});
  useEffect(() => {
    if (initial) setTable(initial);
  }, [initial]);

  if (!catalog || !initial) return <p className="page-loading">Loading…</p>;
  const productName = product?.name ?? catalog.product.name;
  const speeds = [...(catalog.groups.find((g) => g.code === TURNAROUND)?.values ?? [])].sort((a, b) => a.sortOrder - b.sortOrder);
  const tiers = catalog.quantityTiers;

  const changed = Object.keys(table).filter((k) => !same(table[k], initial[k]));
  const errors = Object.keys(table).filter((k) => cellError(table[k]!));
  const dirty = changed.length > 0;

  const update = (k: string, patch: Partial<Cell>) => setTable((t) => ({ ...t, [k]: { ...t[k]!, ...patch } }));

  /** Ticking an empty cell starts from the nearest offered cell of the same speed. */
  function toggle(value: string, quantity: number) {
    const k = key(value, quantity);
    const cell = table[k]!;
    if (cell.offered || cell.days) return update(k, { offered: !cell.offered });
    const column = tiers.map((t) => table[key(value, t.quantity)]!).filter((c) => c.offered);
    const nearest = column.at(-1);
    update(k, { offered: true, days: nearest?.days ?? '1', percent: nearest?.percent ?? '0' });
  }

  /** Copies the first offered percent of a speed to every quantity that offers it. */
  function samePercent(value: string) {
    const cells = tiers.map((t) => key(value, t.quantity)).filter((k) => table[k]!.offered);
    const percent = table[cells[0] ?? '']?.percent;
    if (percent === undefined) return;
    setTable((t) => ({ ...t, ...Object.fromEntries(cells.map((k) => [k, { ...t[k]!, percent }])) }));
  }

  function save() {
    const cells = Object.entries(table)
      .filter(([, c]) => c.offered)
      .map(([k, c]) => {
        const [value, quantity] = k.split('@');
        return { value: value!, quantity: Number(quantity), businessDays: Number(c.days), percent: Number(c.percent) };
      });
    void saver.save(() => api(`${productPath}/turnarounds`, { method: 'PUT', body: { cells } }), `Saved ${changed.length} change${changed.length === 1 ? '' : 's'}`);
  }

  if (speeds.length === 0) {
    return (
      <div className="page">
        <header className="page-header">
          <h1>Turnaround · {productName}</h1>
        </header>
        <p className="muted">
          {productName} has no turnaround speeds. Add them on the <Link to="/options">Options</Link> page first.
        </p>
      </div>
    );
  }

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>Turnaround · {productName}</h1>
          <p className="muted">
            Production days and price of each speed at each quantity. The percent is added to the printing price (core price and
            add-ons); use a negative percent for a discount. Untick a cell to stop offering that speed at that quantity. Every
            quantity needs at least one speed. Add, rename or reorder speeds on the <Link to="/options">Options</Link> page.
          </p>
        </div>
        <div className="header-actions">
          {dirty && (
            <button type="button" className="btn btn-ghost" onClick={() => setTable(initial)}>
              Discard
            </button>
          )}
          <button type="button" className="btn btn-primary" disabled={!dirty || errors.length > 0 || saver.saving} onClick={save}>
            {dirty ? `Save changes (${changed.length})` : 'No changes'}
          </button>
        </div>
      </header>
      {errors.length > 0 && <div className="banner banner-error">{cellError(table[errors[0]!]!)} (highlighted cells).</div>}

      <div className="card table-scroll">
        <table className="price-table turnaround-table">
          <thead>
            <tr>
              <th>Quantity</th>
              {speeds.map((speed) => (
                <th key={speed.code} className={speed.isActive ? '' : 'col-hidden'}>
                  {speed.label}
                  {speed.isDefault && <span className="badge badge-default">Default</span>}
                  {!speed.isActive && <span className="badge">Hidden</span>}
                  <button type="button" className="link-btn turnaround-same" onClick={() => samePercent(speed.code)}>
                    Same % for all
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {tiers.map((tier) => (
              <tr key={tier.quantity} className={tier.isActive ? '' : 'row-hidden'}>
                <th className="row-label">
                  {tier.quantity.toLocaleString('en-US')}
                  {tier.isDefault && <span className="badge badge-default">Default</span>}
                </th>
                {speeds.map((speed) => {
                  const k = key(speed.code, tier.quantity);
                  const cell = table[k];
                  if (!cell) return <td key={speed.code} />;
                  const isChanged = !same(cell, initial[k]);
                  const invalid = Boolean(cellError(cell));
                  return (
                    <td key={speed.code} className={`turnaround-cell ${cell.offered ? '' : 'turnaround-off'}`}>
                      <input
                        type="checkbox"
                        checked={cell.offered}
                        onChange={() => toggle(speed.code, tier.quantity)}
                        aria-label={`Offer ${speed.label} at quantity ${tier.quantity}`}
                      />
                      {cell.offered ? (
                        <>
                          <input
                            className={`money turnaround-days ${isChanged ? 'money-changed' : ''} ${invalid ? 'money-invalid' : ''}`}
                            inputMode="numeric"
                            value={cell.days}
                            onChange={(e) => update(k, { days: e.target.value })}
                            aria-label={`${speed.label} at ${tier.quantity}: business days`}
                          />
                          <span className="muted">d</span>
                          <input
                            className={`money turnaround-percent ${isChanged ? 'money-changed' : ''} ${invalid ? 'money-invalid' : ''}`}
                            inputMode="decimal"
                            value={cell.percent}
                            onChange={(e) => update(k, { percent: e.target.value })}
                            aria-label={`${speed.label} at ${tier.quantity}: percent`}
                          />
                          <span className="muted">%</span>
                        </>
                      ) : (
                        <span className="muted">Not offered</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Toast status={saver.status} onClose={saver.clearStatus} />
    </div>
  );
}
