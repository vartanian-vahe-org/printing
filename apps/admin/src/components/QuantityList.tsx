import { useState } from 'react';
import { Link } from 'react-router';
import { api, type AdminTier } from '../api';
import { useCatalog, useSaver } from '../catalog';

type Saver = ReturnType<typeof useSaver>;

const shown = (quantity: number) => quantity.toLocaleString('en-US');

/** Options page tab: the quantities of the product, always from smallest to largest. */
export function QuantityList({ saver }: { saver: Saver }) {
  const { catalog } = useCatalog();
  if (!catalog) return null;
  const count = (code: string) => catalog.groups.find((g) => g.code === code)?.values.length ?? 0;
  const combinations = count('size') * count('paper') * count('printed_side');

  return (
    <div className="card">
      {catalog.quantityTiers.map((tier) => (
        <QuantityRow
          key={tier.quantity}
          tier={tier}
          priced={catalog.corePrices.filter((p) => p.quantity === tier.quantity).length}
          combinations={combinations}
          saver={saver}
        />
      ))}
      <AddQuantity saver={saver} />
    </div>
  );
}

function QuantityRow({ tier, priced, combinations, saver }: { tier: AdminTier; priced: number; combinations: number; saver: Saver }) {
  const { path: productPath, product } = useCatalog();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(String(tier.quantity));
  const [confirmDelete, setConfirmDelete] = useState(false);
  const path = `${productPath}/quantities/${tier.quantity}`;

  const setTier = (body: Record<string, unknown>, message: string) =>
    saver.save(() => api(`${productPath}/pricing`, { method: 'PUT', body: { tiers: [{ quantity: tier.quantity, ...body }] } }), message);

  return (
    <div className={`value-row quantity-row ${tier.isActive ? '' : 'value-hidden'}`}>
      <div className="value-summary">
        <div className="value-main">
          <div className="value-label">
            {shown(tier.quantity)}
            {tier.isDefault && <span className="badge badge-default">Default</span>}
            {!tier.isActive && <span className="badge">Hidden</span>}
            {priced === 0 && <span className="badge badge-rule">Not sold yet</span>}
          </div>
          {priced === 0 ? (
            <Link className="value-code" to={`/products/${product?.code}/prices`}>
              Enter its prices on the Prices tab
            </Link>
          ) : (
            <span className="value-code">
              {priced} of {combinations} prices set
            </span>
          )}
        </div>
        <div className="value-actions">
          {!tier.isDefault && tier.isActive && (
            <button
              type="button"
              className="btn btn-small"
              disabled={saver.saving}
              onClick={() => void setTier({ isDefault: true }, `Default quantity is now ${shown(tier.quantity)}`)}
            >
              Make default
            </button>
          )}
          {!tier.isDefault && (
            <button
              type="button"
              className="btn btn-small"
              disabled={saver.saving}
              onClick={() => void setTier({ isActive: !tier.isActive }, tier.isActive ? 'Hidden from storefront' : 'Shown on storefront')}
            >
              {tier.isActive ? 'Hide' : 'Show'}
            </button>
          )}
          <button
            type="button"
            className="btn btn-small"
            aria-expanded={open}
            onClick={() => {
              setText(String(tier.quantity));
              setOpen(!open);
              setConfirmDelete(false);
            }}
          >
            {open ? 'Close' : 'Edit'}
          </button>
        </div>
      </div>

      {open && (
        <form
          className="value-form"
          onSubmit={(e) => {
            e.preventDefault();
            const quantity = Number(text);
            void saver.save(() => api(path, { method: 'PATCH', body: { quantity } }), `Changed to ${shown(quantity)}`).then((ok) => ok && setOpen(false));
          }}
        >
          <div className="form-grid">
            <QuantityField value={text} onChange={setText} />
          </div>
          <p className="muted">Its prices and turnaround stay the same, so check them after changing the number.</p>
          <div className="form-actions">
            <button type="submit" className="btn btn-primary" disabled={saver.saving || Number(text) === tier.quantity}>
              Save
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <span className="form-actions-spacer" />
            {tier.isDefault ? (
              <span className="muted">The default quantity cannot be deleted.</span>
            ) : (
              <button type="button" className="btn btn-ghost btn-danger-text" onClick={() => setConfirmDelete(true)}>
                Delete quantity
              </button>
            )}
          </div>
          {confirmDelete && (
            <div className="confirm-box" role="alert">
              <p>
                Delete <strong>{shown(tier.quantity)}</strong>? Its prices and turnaround are deleted too. Carts holding it ask the customer to
                choose again; placed orders are not affected. To take it off the storefront for a while, use Hide instead.
              </p>
              <div className="form-actions">
                <button
                  type="button"
                  className="btn btn-danger"
                  disabled={saver.saving}
                  onClick={() => void saver.save(() => api(path, { method: 'DELETE' }), `${shown(tier.quantity)} deleted`)}
                >
                  Delete
                </button>
                <button type="button" className="btn btn-ghost" onClick={() => setConfirmDelete(false)}>
                  Keep it
                </button>
              </div>
            </div>
          )}
        </form>
      )}
    </div>
  );
}

function AddQuantity({ saver }: { saver: Saver }) {
  const { catalog, path: productPath } = useCatalog();
  const [open, setOpen] = useState(catalog?.quantityTiers.length === 0);
  const [text, setText] = useState('');

  if (!open) {
    return (
      <div className="value-row value-add">
        <button
          type="button"
          className="btn btn-small"
          onClick={() => {
            setText('');
            setOpen(true);
          }}
        >
          + Add quantity
        </button>
      </div>
    );
  }

  return (
    <div className="value-row value-add">
      <form
        className="value-form value-form-new"
        onSubmit={(e) => {
          e.preventDefault();
          const quantity = Number(text);
          void saver
            .save(() => api(`${productPath}/quantities`, { method: 'POST', body: { quantity } }), `${shown(quantity)} added. Enter its prices on the Prices tab.`)
            .then((ok) => ok && setOpen(false));
        }}
      >
        <h3 className="form-subtitle">New quantity</h3>
        <div className="form-grid">
          <QuantityField value={text} onChange={setText} autoFocus />
        </div>
        <p className="muted">It starts with the turnaround of the closest quantity. Customers see it once it has prices.</p>
        <div className="form-actions">
          <button type="submit" className="btn btn-primary" disabled={saver.saving || !text.trim()}>
            Add quantity
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}

function QuantityField({ value, onChange, autoFocus }: { value: string; onChange: (value: string) => void; autoFocus?: boolean }) {
  return (
    <label className="field">
      <span>Quantity</span>
      <input type="number" min={1} max={1_000_000} step={1} value={value} onChange={(e) => onChange(e.target.value)} required autoFocus={autoFocus} />
    </label>
  );
}
