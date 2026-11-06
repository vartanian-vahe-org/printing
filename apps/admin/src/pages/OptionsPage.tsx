import { useState } from 'react';
import { api, type AdminGroup, type AdminValue } from '../api';
import { useCatalog, useSaver } from '../catalog';
import { AttributeEditor } from '../components/AttributeEditor';
import { QuantityList } from '../components/QuantityList';
import { Toast } from '../components/Toast';

/** Quantities are not an option group, so their tab sits after the groups. */
const QUANTITY_TAB = 'quantity';

/** Every product needs these groups; the rest are add-ons the admin adds and deletes. */
const REQUIRED_GROUPS = ['size', 'paper', 'printed_side', 'turnaround'];

/** Details to fill in for the first option of an empty group; later ones start from an existing option. */
const BLANK_ATTRIBUTES: Record<string, Record<string, unknown>> = {
  size: { trim_w_in: Number.NaN, trim_h_in: Number.NaN, bleed_in: Number.NaN, safe_in: Number.NaN },
  paper: { thickness_pt: Number.NaN },
  printed_side: { back: 'separate' },
};

export function OptionsPage() {
  const { catalog } = useCatalog();
  const [groupCode, setGroupCode] = useState('size');
  const saver = useSaver();

  if (!catalog) return <p className="page-loading">Loading…</p>;
  const group = catalog.groups.find((g) => g.code === groupCode) ?? catalog.groups[0]!;
  const showQuantities = groupCode === QUANTITY_TAB;

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>Options</h1>
          <p className="muted">Add, rename, reorder, hide or delete options and choose the default. Changes show on the storefront right away.</p>
        </div>
      </header>

      <div className="tabs">
        {catalog.groups.map((g) => (
          <button
            key={g.code}
            type="button"
            className={`tab ${!showQuantities && g.code === group.code ? 'tab-active' : ''}`}
            onClick={() => setGroupCode(g.code)}
          >
            {g.label}
            <span className="tab-count">{g.values.filter((v) => v.isActive).length}</span>
          </button>
        ))}
        <button type="button" className={`tab ${showQuantities ? 'tab-active' : ''}`} onClick={() => setGroupCode(QUANTITY_TAB)}>
          Quantity
          <span className="tab-count">{catalog.quantityTiers.filter((t) => t.isActive).length}</span>
        </button>
        <AddGroup saver={saver} onAdded={setGroupCode} />
      </div>

      {showQuantities ? (
        <QuantityList saver={saver} />
      ) : (
        <div className="card">
          <GroupHeader key={`header.${group.code}`} group={group} saver={saver} />
          <OptionList key={group.code} group={group} saver={saver} />
        </div>
      )}

      <Toast status={saver.status} onClose={saver.clearStatus} />
    </div>
  );
}

/** The options of a group, then the form for a new one. `guided`: the setup wizard, with the form open on an empty group. */
export function OptionList({ group, saver, guided = false }: { group: AdminGroup; saver: ReturnType<typeof useSaver>; guided?: boolean }) {
  return (
    <>
      {group.values.map((value, index) => (
        <ValueRow
          key={`${group.code}.${value.code}`}
          group={group}
          value={value}
          first={index === 0}
          last={index === group.values.length - 1}
          neighbours={[group.values[index - 1], group.values[index + 1]]}
          saver={saver}
        />
      ))}
      <AddValue key={group.code} group={group} saver={saver} guided={guided} />
    </>
  );
}

/** Rename any group; add-on groups can also be deleted. */
function GroupHeader({ group, saver }: { group: AdminGroup; saver: ReturnType<typeof useSaver> }) {
  const { path: productPath } = useCatalog();
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState(group.label);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const path = `${productPath}/groups/${group.code}`;
  const required = REQUIRED_GROUPS.includes(group.code);

  return (
    <div className="value-row">
      <div className="value-summary">
        <div className="value-main">
          <div className="value-label">{group.label}</div>
          <span className="value-code">{required ? 'Every product needs this group' : 'Add-on group'}</span>
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
            {!required && (
              <button type="button" className="btn btn-ghost btn-danger-text" onClick={() => setConfirmDelete(true)}>
                Delete group
              </button>
            )}
          </div>
          {confirmDelete && (
            <div className="confirm-box" role="alert">
              <p>
                Delete <strong>{group.label}</strong>? Its options and rules are deleted too. Carts holding this product ask the customer to choose
                again; placed orders are not affected.
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

/** "Add group": a new add-on such as Binding or Grommets, priced as a percent on the Pricing page. */
export function AddGroup({ saver, onAdded }: { saver: ReturnType<typeof useSaver>; onAdded: (code: string) => void }) {
  const { path: productPath, product } = useCatalog();
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
        + Add group
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
            const result = await api<{ code: string }>(`${productPath}/groups`, { method: 'POST', body: { label: label.trim(), firstOption: firstOption.trim() } });
            created = result.code;
          }, `${label.trim()} added`)
          .then((ok) => {
            if (!ok) return;
            setOpen(false);
            onAdded(created);
          });
      }}
    >
      <h3 className="form-subtitle">New option group</h3>
      <div className="form-grid">
        <label className="field">
          <span>Name (shown to customers)</span>
          <input value={label} onChange={(e) => setLabel(e.target.value)} required maxLength={120} autoFocus placeholder="e.g. Folding" />
        </label>
        <label className="field">
          <span>First option (the default)</span>
          <input value={firstOption} onChange={(e) => setFirstOption(e.target.value)} required maxLength={120} placeholder="e.g. No fold" />
        </label>
      </div>
      <p className="muted">
        It is an add-on: its options add a percent, set on the Pricing page.
        {product?.isActive && ' Carts holding this product ask the customer to choose again.'}
      </p>
      <div className="form-actions">
        <button type="submit" className="btn btn-primary" disabled={saver.saving || !label.trim() || !firstOption.trim()}>
          Add group
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
  first,
  last,
  neighbours,
  saver,
}: {
  group: AdminGroup;
  value: AdminValue;
  first: boolean;
  last: boolean;
  neighbours: [AdminValue | undefined, AdminValue | undefined];
  saver: ReturnType<typeof useSaver>;
}) {
  const { path: productPath } = useCatalog();
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState(value.label);
  const [description, setDescription] = useState(value.description ?? '');
  const [attributes, setAttributes] = useState(value.attributes);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const path = `${productPath}/groups/${group.code}/values/${value.code}`;

  const patch = (body: Record<string, unknown>, text?: string) =>
    saver.save(() => api(path, { method: 'PATCH', body }), text);

  /** Swaps sort order with the neighbour above (-1) or below (+1). */
  async function move(direction: -1 | 1) {
    const other = neighbours[direction === -1 ? 0 : 1];
    if (!other) return;
    await saver.save(async () => {
      await api(path, { method: 'PATCH', body: { sortOrder: other.sortOrder } });
      await api(`${productPath}/groups/${group.code}/values/${other.code}`, {
        method: 'PATCH',
        body: { sortOrder: value.sortOrder },
      });
    }, 'Order updated');
  }

  return (
    <div className={`value-row ${value.isActive ? '' : 'value-hidden'}`}>
      <div className="value-summary">
        <div className="value-order">
          <button type="button" className="icon-btn" disabled={first || saver.saving} onClick={() => void move(-1)} aria-label="Move up">
            ↑
          </button>
          <button type="button" className="icon-btn" disabled={last || saver.saving} onClick={() => void move(1)} aria-label="Move down">
            ↓
          </button>
        </div>
        <div className="value-main">
          <div className="value-label">
            {value.label}
            {value.isDefault && <span className="badge badge-default">Default</span>}
            {!value.isActive && <span className="badge">Hidden</span>}
          </div>
          <code className="value-code">{value.code}</code>
        </div>
        <div className="value-actions">
          {!value.isDefault && value.isActive && (
            <button type="button" className="btn btn-small" disabled={saver.saving} onClick={() => void patch({ isDefault: true }, 'Default changed')}>
              Make default
            </button>
          )}
          {!value.isDefault && (
            <button
              type="button"
              className="btn btn-small"
              disabled={saver.saving}
              onClick={() => void patch({ isActive: !value.isActive }, value.isActive ? 'Hidden from storefront' : 'Shown on storefront')}
            >
              {value.isActive ? 'Hide' : 'Show'}
            </button>
          )}
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
            void patch({ label, description: description.trim() || null, attributes }).then((ok) => ok && setOpen(false));
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
          <h3 className="form-subtitle">Details</h3>
          <AttributeEditor groupCode={group.code} value={attributes} onChange={setAttributes} />
          <div className="form-actions">
            <button type="submit" className="btn btn-primary" disabled={saver.saving}>
              Save
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                setLabel(value.label);
                setDescription(value.description ?? '');
                setAttributes(value.attributes);
                setOpen(false);
              }}
            >
              Cancel
            </button>
            <span className="form-actions-spacer" />
            {value.isDefault ? (
              <span className="muted">The default option cannot be deleted.</span>
            ) : (
              <button type="button" className="btn btn-ghost btn-danger-text" onClick={() => setConfirmDelete(true)}>
                Delete option
              </button>
            )}
          </div>
          {confirmDelete && (
            <div className="confirm-box" role="alert">
              <p>
                Delete <strong>{value.label}</strong>? Its prices and rules are deleted too. Carts holding it ask the customer to choose
                again; placed orders are not affected. To take it off the storefront for a while, use Hide instead.
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
 * "Add option": starts from an existing option of the group (its details, and if ticked its
 * prices and rules), so nothing new has to be invented and the storefront keeps working. The first
 * option of an empty group starts blank and becomes the default.
 */
function AddValue({ group, saver, guided }: { group: AdminGroup; saver: ReturnType<typeof useSaver>; guided: boolean }) {
  const { path: productPath } = useCatalog();
  const sources = group.values;
  const initial = sources.find((v) => v.isDefault) ?? sources[0];
  const [open, setOpen] = useState(guided && sources.length === 0);
  const [label, setLabel] = useState('');
  const [description, setDescription] = useState('');
  const [code, setCode] = useState('');
  const [sourceCode, setSourceCode] = useState(initial?.code ?? '');
  const [copy, setCopy] = useState(true);
  const startAttributes = initial?.attributes ?? BLANK_ATTRIBUTES[group.code] ?? {};
  const [attributes, setAttributes] = useState<Record<string, unknown>>(startAttributes);
  const source = sources.find((v) => v.code === sourceCode);

  function reset() {
    setLabel('');
    setDescription('');
    setCode('');
    setSourceCode(initial?.code ?? '');
    setCopy(true);
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
          + Add {group.label.toLowerCase()} option
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
          void saver
            .save(
              () =>
                api(`${productPath}/groups/${group.code}/values`, {
                  method: 'POST',
                  body: {
                    label: label.trim(),
                    description: description.trim() || null,
                    ...(code.trim() ? { code: code.trim() } : {}),
                    attributes,
                    ...(copy && source ? { copyFrom: source.code } : {}),
                  },
                }),
              `${label.trim()} added`,
            )
            .then((ok) => ok && setOpen(false));
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
          {source && (
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
          {!guided && (
            <label className="field">
              <span>Code (optional)</span>
              <input
                value={code}
                onChange={(e) => setCode(e.target.value.toLowerCase())}
                pattern="[a-z0-9]+(_[a-z0-9]+)*"
                title="Lowercase letters, numbers and underscores"
                maxLength={60}
                placeholder="Made from the label"
              />
            </label>
          )}
        </div>
        {source && (
          <label className="field field-inline">
            <input type="checkbox" checked={copy} onChange={(e) => setCopy(e.target.checked)} />
            <span>
              Copy the prices and rules of {source.label}
              {!copy && ' (otherwise: no price yet, and rules that limit this group leave the new option out)'}
            </span>
          </label>
        )}
        <h3 className="form-subtitle">Details</h3>
        <AttributeEditor groupCode={group.code} value={attributes} onChange={setAttributes} />
        <div className="form-actions">
          <button type="submit" className="btn btn-primary" disabled={saver.saving || !label.trim()}>
            Add option
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
