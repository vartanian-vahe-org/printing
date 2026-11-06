import { useState } from 'react';
import { api, type LibraryGroup, type LibraryQuantity, type LibraryValue } from '../api';
import { useCatalog, useSaver } from '../catalog';
import { AttributeEditor } from '../components/AttributeEditor';
import { Toast } from '../components/Toast';
import { LibraryDesignServices } from './DesignServicesPage';

type Saver = ReturnType<typeof useSaver>;

/** Quantities are not an option group, so their tab sits after the groups. */
const QUANTITY_TAB = 'quantity';
const DESIGN_TAB = 'design-services';
const shown = (quantity: number) => quantity.toLocaleString('en-US');

/** Details to fill in for the first option of an empty group; later ones start from an existing option. */
const BLANK_ATTRIBUTES: Record<string, Record<string, unknown>> = {
  size: { trim_w_in: Number.NaN, trim_h_in: Number.NaN, bleed_in: Number.NaN, safe_in: Number.NaN },
  paper: { thickness_pt: Number.NaN },
  printed_side: { back: 'separate' },
  turnaround: { min_days: Number.NaN, max_days: Number.NaN, percent: Number.NaN },
};

/** "3–4 business days · +30%", from a speed's details. */
export function speedSummary(attributes: Record<string, unknown>): string {
  const { min_days: first, max_days: last, percent } = attributes as { min_days: number; max_days: number; percent: number };
  const days = first === last ? `${last} business day${last === 1 ? '' : 's'}` : `${first}–${last} business days`;
  return `${days} · ${percent > 0 ? '+' : ''}${percent}%`;
}

/** The option library: created once here, then each product picks what it uses. */
export function OptionsPage() {
  const { library, libraryDesignServices, libraryQuantities } = useCatalog();
  const [groupCode, setGroupCode] = useState('size');
  const saver = useSaver();

  const group = library.find((g) => g.code === groupCode) ?? library[0];
  if (!group) return <p className="page-loading">Loading…</p>;
  const showQuantities = groupCode === QUANTITY_TAB;
  const showDesign = groupCode === DESIGN_TAB;

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>Option library</h1>
          <p className="muted">
            Every size, paper, add-on, quantity and design service is created once here and shared by all products. A change reaches every product using it. What
            a product offers, and its prices, are set on the product.
          </p>
        </div>
      </header>

      <div className="tabs">
        {library.map((g) => (
          <button key={g.code} type="button" className={`tab ${!showQuantities && !showDesign && g.code === group.code ? 'tab-active' : ''}`} onClick={() => setGroupCode(g.code)}>
            {g.label}
            <span className="tab-count">{g.values.length}</span>
          </button>
        ))}
        <button type="button" className={`tab ${showQuantities ? 'tab-active' : ''}`} onClick={() => setGroupCode(QUANTITY_TAB)}>
          Quantity
          <span className="tab-count">{libraryQuantities.length}</span>
        </button>
        <button type="button" className={`tab ${showDesign ? 'tab-active' : ''}`} onClick={() => setGroupCode(DESIGN_TAB)}>
          Design services
          <span className="tab-count">{libraryDesignServices.length}</span>
        </button>
        <AddGroup saver={saver} onAdded={setGroupCode} />
      </div>

      {showDesign ? (
        <LibraryDesignServices saver={saver} />
      ) : showQuantities ? (
        <div className="card">
          {libraryQuantities.map((q) => (
            <QuantityRow key={q.quantity} value={q} saver={saver} />
          ))}
          <AddLibraryQuantity saver={saver} />
        </div>
      ) : (
        <div className="card">
          <GroupHeader key={`header.${group.code}`} group={group} saver={saver} />
          {group.values.map((value, index) => (
            <ValueRow key={`${group.code}.${value.code}`} group={group} value={value} neighbours={[group.values[index - 1], group.values[index + 1]]} saver={saver} />
          ))}
          <AddLibraryValue key={group.code} group={group} saver={saver} />
        </div>
      )}

      <Toast status={saver.status} onClose={saver.clearStatus} />
    </div>
  );
}

function QuantityRow({ value, saver }: { value: LibraryQuantity; saver: Saver }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(String(value.quantity));
  const [confirmDelete, setConfirmDelete] = useState(false);
  const path = `/admin/options/quantities/${value.quantity}`;

  return (
    <div className="value-row quantity-row">
      <div className="value-summary">
        <div className="value-main">
          <div className="value-label">{shown(value.quantity)}</div>
          <span className="value-code">{value.usedBy.length ? `Used by ${value.usedBy.join(', ')}` : 'Not used by any product yet'}</span>
        </div>
        <div className="value-actions">
          <button
            type="button"
            className="btn btn-small"
            aria-expanded={open}
            onClick={() => {
              setText(String(value.quantity));
              setConfirmDelete(false);
              setOpen(!open);
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
          {value.usedBy.length > 0 && <p className="muted">This changes it on {value.usedBy.join(', ')}. Their prices and turnaround stay the same, so check them after.</p>}
          <div className="form-actions">
            <button type="submit" className="btn btn-primary" disabled={saver.saving || Number(text) === value.quantity}>
              Save
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <span className="form-actions-spacer" />
            {value.usedBy.length ? (
              <span className="muted">Remove it from {value.usedBy.join(', ')} before deleting it.</span>
            ) : (
              <button type="button" className="btn btn-ghost btn-danger-text" onClick={() => setConfirmDelete(true)}>
                Delete quantity
              </button>
            )}
          </div>
          {confirmDelete && (
            <div className="confirm-box" role="alert">
              <p>
                Delete <strong>{shown(value.quantity)}</strong> from the library?
              </p>
              <div className="form-actions">
                <button type="button" className="btn btn-danger" disabled={saver.saving} onClick={() => void saver.save(() => api(path, { method: 'DELETE' }), `${shown(value.quantity)} deleted`)}>
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

/** "Add quantity" to the library. `onAdded`: on a product, ticks the new quantity. */
export function AddLibraryQuantity({ saver, onAdded }: { saver: Saver; onAdded?: (quantity: number) => void }) {
  const { libraryQuantities } = useCatalog();
  const [open, setOpen] = useState(libraryQuantities.length === 0);
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
          + New quantity
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
          void saver.save(() => api('/admin/options/quantities', { method: 'POST', body: { quantity } }), `${shown(quantity)} added`).then((ok) => {
            if (!ok) return;
            onAdded?.(quantity);
            setOpen(false);
          });
        }}
      >
        <h3 className="form-subtitle">New quantity</h3>
        <div className="form-grid">
          <QuantityField value={text} onChange={setText} autoFocus />
        </div>
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

/** Rename any group; add-on groups nothing uses can also be deleted. */
function GroupHeader({ group, saver }: { group: LibraryGroup; saver: Saver }) {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState(group.label);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const path = `/admin/options/groups/${group.code}`;
  const inUse = group.values.some((v) => v.usedBy.length > 0);

  return (
    <div className="value-row">
      <div className="value-summary">
        <div className="value-main">
          <div className="value-label">{group.label}</div>
          <span className="value-code">{group.required ? 'Every product needs this group' : 'Add-on group'}</span>
        </div>
        <div className="value-actions">
          <button
            type="button"
            className="btn btn-small"
            aria-expanded={open}
            onClick={() => {
              setLabel(group.label);
              setConfirmDelete(false);
              setOpen(!open);
            }}
          >
            {open ? 'Close' : 'Edit group'}
          </button>
        </div>
      </div>

      {open && (
        <form
          className="value-form"
          onSubmit={(e) => {
            e.preventDefault();
            void saver.save(() => api(path, { method: 'PATCH', body: { label: label.trim() } }), 'Group renamed').then((ok) => ok && setOpen(false));
          }}
        >
          <div className="form-grid">
            <label className="field">
              <span>Name (shown to customers)</span>
              <input value={label} onChange={(e) => setLabel(e.target.value)} required maxLength={120} />
            </label>
          </div>
          <div className="form-actions">
            <button type="submit" className="btn btn-primary" disabled={saver.saving || !label.trim()}>
              Save
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <span className="form-actions-spacer" />
            {!group.required &&
              (inUse ? (
                <span className="muted">Products use this group, so it cannot be deleted.</span>
              ) : (
                <button type="button" className="btn btn-ghost btn-danger-text" onClick={() => setConfirmDelete(true)}>
                  Delete group
                </button>
              ))}
          </div>
          {confirmDelete && (
            <div className="confirm-box" role="alert">
              <p>
                Delete <strong>{group.label}</strong> and its options from the library?
              </p>
              <div className="form-actions">
                <button
                  type="button"
                  className="btn btn-danger"
                  disabled={saver.saving}
                  onClick={() => void saver.save(() => api(path, { method: 'DELETE' }), `${group.label} deleted`)}
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

/** A new add-on group such as Binding or Grommets, for any product to use. */
export function AddGroup({ saver, onAdded }: { saver: Saver; onAdded: (code: string) => void }) {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState('');
  const [firstOption, setFirstOption] = useState('');

  if (!open) {
    return (
      <button
        type="button"
        className="tab"
        onClick={() => {
          setLabel('');
          setFirstOption('');
          setOpen(true);
        }}
      >
        + Add add-on group
      </button>
    );
  }

  return (
    <form
      className="value-form value-form-new group-form"
      onSubmit={(e) => {
        e.preventDefault();
        let created = '';
        void saver
          .save(async () => {
            const result = await api<{ code: string }>('/admin/options/groups', { method: 'POST', body: { label: label.trim(), firstOption: firstOption.trim() } });
            created = result.code;
          }, `${label.trim()} added`)
          .then((ok) => {
            if (!ok) return;
            setOpen(false);
            onAdded(created);
          });
      }}
    >
      <h3 className="form-subtitle">New add-on group</h3>
      <div className="form-grid">
        <label className="field">
          <span>Name (shown to customers)</span>
          <input value={label} onChange={(e) => setLabel(e.target.value)} required maxLength={120} autoFocus placeholder="e.g. Folding" />
        </label>
        <label className="field">
          <span>First option</span>
          <input value={firstOption} onChange={(e) => setFirstOption(e.target.value)} required maxLength={120} placeholder="e.g. No fold" />
        </label>
      </div>
      <p className="muted">Extras such as folding or grommets. They add a percent to the price, set on each product.</p>
      <div className="form-actions">
        <button type="submit" className="btn btn-primary" disabled={saver.saving || !label.trim() || !firstOption.trim()}>
          Add add-on group
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function ValueRow({
  group,
  value,
  neighbours,
  saver,
}: {
  group: LibraryGroup;
  value: LibraryValue;
  neighbours: [LibraryValue | undefined, LibraryValue | undefined];
  saver: Saver;
}) {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState(value.label);
  const [description, setDescription] = useState(value.description ?? '');
  const [attributes, setAttributes] = useState(value.attributes);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const path = `/admin/options/groups/${group.code}/values/${value.code}`;

  /** Swaps sort order with the neighbour above (-1) or below (+1). */
  async function move(direction: -1 | 1) {
    const other = neighbours[direction === -1 ? 0 : 1];
    if (!other) return;
    await saver.save(async () => {
      await api(path, { method: 'PATCH', body: { sortOrder: other.sortOrder } });
      await api(`/admin/options/groups/${group.code}/values/${other.code}`, { method: 'PATCH', body: { sortOrder: value.sortOrder } });
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
          <div className="value-label">{value.label}</div>
          {group.code === 'turnaround' && <span className="muted">{speedSummary(value.attributes)}</span>}
          <span className="value-code">{value.usedBy.length ? `Used by ${value.usedBy.join(', ')}` : 'Not used by any product yet'}</span>
        </div>
        <div className="value-actions">
          <button
            type="button"
            className="btn btn-small"
            aria-expanded={open}
            onClick={() => {
              // Start editing from the latest saved values.
              if (!open) {
                setLabel(value.label);
                setDescription(value.description ?? '');
                setAttributes(value.attributes);
              }
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
            void saver
              .save(() => api(path, { method: 'PATCH', body: { label, description: description.trim() || null, attributes } }), `${label.trim()} saved`)
              .then((ok) => ok && setOpen(false));
          }}
        >
          <div className="form-grid">
            <label className="field">
              <span>Label (shown to customers)</span>
              <input value={label} onChange={(e) => setLabel(e.target.value)} required maxLength={120} />
            </label>
            <label className="field">
              <span>Description</span>
              <input value={description} onChange={(e) => setDescription(e.target.value)} maxLength={300} />
            </label>
          </div>
          {Object.keys(attributes).length > 0 && (
            <>
              <h3 className="form-subtitle">Details</h3>
              <AttributeEditor groupCode={group.code} value={attributes} onChange={setAttributes} />
            </>
          )}
          {value.usedBy.length > 1 && <p className="muted">This changes it on {value.usedBy.join(', ')}.</p>}
          {group.code === 'turnaround' && <p className="muted">Quantities a product changed on its Turnaround tab keep their own days and percent.</p>}
          <div className="form-actions">
            <button type="submit" className="btn btn-primary" disabled={saver.saving}>
              Save
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <span className="form-actions-spacer" />
            {value.usedBy.length ? (
              <span className="muted">Remove it from {value.usedBy.join(', ')} before deleting it.</span>
            ) : (
              <button type="button" className="btn btn-ghost btn-danger-text" onClick={() => setConfirmDelete(true)}>
                Delete option
              </button>
            )}
          </div>
          {confirmDelete && (
            <div className="confirm-box" role="alert">
              <p>
                Delete <strong>{value.label}</strong> from the library?
              </p>
              <div className="form-actions">
                <button
                  type="button"
                  className="btn btn-danger"
                  disabled={saver.saving}
                  onClick={() => void saver.save(() => api(path, { method: 'DELETE' }), `${value.label} deleted`)}
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

/**
 * "Add option" to the library. Its details start from an existing option of the group, or blank for
 * the first one. `onAdded`: on a product, ticks the new option.
 */
export function AddLibraryValue({ group, saver, onAdded }: { group: LibraryGroup; saver: Saver; onAdded?: (code: string) => void }) {
  const sources = group.values;
  const initial = sources[0];
  const startAttributes = initial?.attributes ?? BLANK_ATTRIBUTES[group.code] ?? {};
  const [open, setOpen] = useState(sources.length === 0);
  const [label, setLabel] = useState('');
  const [description, setDescription] = useState('');
  const [sourceCode, setSourceCode] = useState(initial?.code ?? '');
  const [attributes, setAttributes] = useState<Record<string, unknown>>(startAttributes);

  function reset() {
    setLabel('');
    setDescription('');
    setSourceCode(initial?.code ?? '');
    setAttributes(startAttributes);
  }

  if (!open) {
    return (
      <div className="value-row value-add">
        <button
          type="button"
          className="btn btn-small"
          onClick={() => {
            reset();
            setOpen(true);
          }}
        >
          + New {group.label.toLowerCase()} option
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
          let created = '';
          void saver
            .save(async () => {
              const result = await api<{ code: string }>(`/admin/options/groups/${group.code}/values`, {
                method: 'POST',
                body: { label: label.trim(), description: description.trim() || null, attributes },
              });
              created = result.code;
            }, `${label.trim()} added`)
            .then((ok) => {
              if (!ok) return;
              onAdded?.(created);
              reset();
              setOpen(false);
            });
        }}
      >
        <h3 className="form-subtitle">New {group.label.toLowerCase()} option</h3>
        <div className="form-grid">
          <label className="field">
            <span>Label (shown to customers)</span>
            <input value={label} onChange={(e) => setLabel(e.target.value)} required maxLength={120} autoFocus />
          </label>
          <label className="field">
            <span>Description</span>
            <input value={description} onChange={(e) => setDescription(e.target.value)} maxLength={300} />
          </label>
          {sources.length > 0 && Object.keys(startAttributes).length > 0 && (
            <label className="field">
              <span>Start from</span>
              <select
                value={sourceCode}
                onChange={(e) => {
                  setSourceCode(e.target.value);
                  setAttributes(sources.find((v) => v.code === e.target.value)?.attributes ?? {});
                }}
              >
                {sources.map((v) => (
                  <option key={v.code} value={v.code}>
                    {v.label}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        {Object.keys(attributes).length > 0 && (
          <>
            <h3 className="form-subtitle">Details</h3>
            <AttributeEditor groupCode={group.code} value={attributes} onChange={setAttributes} />
          </>
        )}
        <div className="form-actions">
          <button type="submit" className="btn btn-primary" disabled={saver.saving || !label.trim()}>
            Add option
          </button>
          {sources.length > 0 && (
            <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>
              Cancel
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
