import { useState } from 'react';
import { api, type AdminGroup, type AdminValue } from '../api';
import { useCatalog, useSaver } from '../catalog';
import { AttributeEditor } from '../components/AttributeEditor';
import { Toast } from '../components/Toast';

export function OptionsPage() {
  const { catalog } = useCatalog();
  const [groupCode, setGroupCode] = useState('size');
  const saver = useSaver();

  if (!catalog) return <p className="page-loading">Loading…</p>;
  const group = catalog.groups.find((g) => g.code === groupCode) ?? catalog.groups[0]!;

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
            className={`tab ${g.code === group.code ? 'tab-active' : ''}`}
            onClick={() => setGroupCode(g.code)}
          >
            {g.label}
            <span className="tab-count">{g.values.filter((v) => v.isActive).length}</span>
          </button>
        ))}
      </div>

      <div className="card">
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
        <AddValue key={group.code} group={group} saver={saver} />
      </div>

      <Toast status={saver.status} onClose={saver.clearStatus} />
    </div>
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
                Delete <strong>{value.label}</strong>? Its upcharges and rules are deleted too. Carts holding it ask the customer to choose
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

/** Options a new one can start from: the custom size takes different details than the fixed sizes. */
function startOptions(group: AdminGroup): AdminValue[] {
  return group.values.filter((v) => !(group.code === 'size' && v.code === 'custom'));
}

/**
 * "Add option": starts from an existing option of the group (its details, and if ticked its
 * upcharges and rules), so nothing new has to be invented and the storefront keeps working.
 */
function AddValue({ group, saver }: { group: AdminGroup; saver: ReturnType<typeof useSaver> }) {
  const { path: productPath } = useCatalog();
  const sources = startOptions(group);
  const initial = sources.find((v) => v.isDefault) ?? sources[0];
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState('');
  const [description, setDescription] = useState('');
  const [code, setCode] = useState('');
  const [sourceCode, setSourceCode] = useState(initial?.code ?? '');
  const [copy, setCopy] = useState(true);
  const [attributes, setAttributes] = useState<Record<string, unknown>>(initial?.attributes ?? {});
  const source = sources.find((v) => v.code === sourceCode);

  function reset() {
    setLabel('');
    setDescription('');
    setCode('');
    setSourceCode(initial?.code ?? '');
    setCopy(true);
    setAttributes(initial?.attributes ?? {});
  }

  if (!open) {
    return (
      <div className="value-row value-add">
        <button
          type="button"
          className="btn btn-small"
          disabled={!initial}
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
        </div>
        <label className="field field-inline">
          <input type="checkbox" checked={copy} onChange={(e) => setCopy(e.target.checked)} />
          <span>
            Copy the upcharges and rules of {source?.label ?? 'that option'}
            {!copy && ' (otherwise: $0 upcharge, and rules that limit this group leave the new option out)'}
          </span>
        </label>
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
