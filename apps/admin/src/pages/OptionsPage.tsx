import { useState } from 'react';
import { api, productPath, type AdminGroup, type AdminValue } from '../api';
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
          <p className="muted">Rename, reorder, hide options and choose the default. Changes show on the storefront right away.</p>
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
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState(value.label);
  const [description, setDescription] = useState(value.description ?? '');
  const [attributes, setAttributes] = useState(value.attributes);
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
          </div>
        </form>
      )}
    </div>
  );
}
