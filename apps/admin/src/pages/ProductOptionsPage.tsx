import { useState } from 'react';
import { Link } from 'react-router';
import { api, type AdminValue, type LibraryGroup, type LibraryValue } from '../api';
import { useCatalog, useSaver } from '../catalog';
import { QuantityList } from '../components/QuantityList';
import { Toast } from '../components/Toast';
import { AddLibraryValue } from './OptionsPage';

type Saver = ReturnType<typeof useSaver>;

/** Quantities are not an option group, so their tab sits after the groups. */
const QUANTITY_TAB = 'quantity';

/** What the product picked in the sidebar offers, out of the option library. */
export function ProductOptionsPage() {
  const { catalog, library, product } = useCatalog();
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
          <h1>Options · {product?.name ?? catalog.product.name}</h1>
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

      {showQuantities ? <QuantityList saver={saver} /> : <OptionPicker key={group.code} group={group} saver={saver} />}

      <Toast status={saver.status} onClose={saver.clearStatus} />
    </div>
  );
}

/** Every option of a library group, ticked when the product uses it, and a form for a new one. */
export function OptionPicker({ group, saver, title }: { group: LibraryGroup; saver: Saver; title?: string }) {
  const { catalog, path } = useCatalog();
  const used = catalog?.groups.find((g) => g.code === group.code)?.values ?? [];

  return (
    <div className="card">
      {title && (
        <div className="value-row">
          <div className="value-summary">
            <div className="value-label">{title}</div>
          </div>
        </div>
      )}
      {group.values.map((value) => (
        <PickRow key={value.code} group={group} value={value} use={used.find((v) => v.code === value.code)} saver={saver} />
      ))}
      <AddLibraryValue key={group.code} group={group} saver={saver} useOn={path} />
    </div>
  );
}

function PickRow({ group, value, use, saver }: { group: LibraryGroup; value: LibraryValue; use: AdminValue | undefined; saver: Saver }) {
  const { path: productPath } = useCatalog();
  const [confirmRemove, setConfirmRemove] = useState(false);
  const base = `${productPath}/groups/${group.code}/values`;
  const patch = (body: Record<string, unknown>, text: string) => saver.save(() => api(`${base}/${value.code}`, { method: 'PATCH', body }), text);

  return (
    <div className={`value-row ${use && !use.isActive ? 'value-hidden' : ''}`}>
      <div className="value-summary">
        <input
          type="checkbox"
          className="pick-check"
          checked={Boolean(use)}
          disabled={saver.saving}
          aria-label={`Offer ${value.label}`}
          onChange={() => {
            if (use) setConfirmRemove(true);
            else void saver.save(() => api(base, { method: 'POST', body: { value: value.code } }), `${value.label} added`);
          }}
        />
        <div className="value-main">
          <div className="value-label">
            {value.label}
            {use?.isDefault && <span className="badge badge-default">Default</span>}
            {use && !use.isActive && <span className="badge">Hidden</span>}
          </div>
          {value.description && <span className="value-code">{value.description}</span>}
        </div>
        {use && (
          <div className="value-actions">
            {!use.isDefault && use.isActive && (
              <button type="button" className="btn btn-small" disabled={saver.saving} onClick={() => void patch({ isDefault: true }, 'Default changed')}>
                Make default
              </button>
            )}
            {!use.isDefault && (
              <button
                type="button"
                className="btn btn-small"
                disabled={saver.saving}
                onClick={() => void patch({ isActive: !use.isActive }, use.isActive ? 'Hidden from storefront' : 'Shown on storefront')}
              >
                {use.isActive ? 'Hide' : 'Show'}
              </button>
            )}
          </div>
        )}
      </div>
      {confirmRemove && (
        <div className="confirm-box" role="alert">
          <p>
            Remove <strong>{value.label}</strong> from this product? Its prices and rules on this product are deleted; it stays in the library. To take
            it off the storefront for a while, use Hide instead.
          </p>
          <div className="form-actions">
            <button
              type="button"
              className="btn btn-danger"
              disabled={saver.saving}
              onClick={() => void saver.save(() => api(`${base}/${value.code}`, { method: 'DELETE' }), `${value.label} removed`).then(() => setConfirmRemove(false))}
            >
              Remove
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setConfirmRemove(false)}>
              Keep it
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
