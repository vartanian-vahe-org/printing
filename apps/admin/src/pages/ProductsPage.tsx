import { useState } from 'react';
import { useNavigate } from 'react-router';
import { api, type AdminProduct } from '../api';
import { STOREFRONT_ORIGIN, useCatalog, useSaver } from '../catalog';
import { Toast } from '../components/Toast';

type Saver = ReturnType<typeof useSaver>;

/** A save that also refreshes the product list (sidebar picker included). */
function useProductSave(saver: Saver) {
  const { reloadProducts } = useCatalog();
  return (action: () => Promise<unknown>, text: string) =>
    saver.save(async () => {
      await action();
      await reloadProducts();
    }, text);
}

export function ProductsPage() {
  const { products } = useCatalog();
  const saver = useSaver();

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>Products</h1>
          <p className="muted">
            Each product has its own page, options, prices and quantities. A new product starts blank or as a copy of another one, and stays
            hidden until you show it. The storefront lists them in this order.
          </p>
        </div>
      </header>

      <div className="card">
        {products.map((product, index) => (
          <ProductRow key={product.code} product={product} neighbours={[products[index - 1], products[index + 1]]} saver={saver} />
        ))}
        <AddProduct saver={saver} />
      </div>

      <Toast status={saver.status} onClose={saver.clearStatus} />
    </div>
  );
}

function ProductRow({
  product,
  neighbours,
  saver,
}: {
  product: AdminProduct;
  neighbours: [AdminProduct | undefined, AdminProduct | undefined];
  saver: Saver;
}) {
  const { selectProduct } = useCatalog();
  const navigate = useNavigate();
  const save = useProductSave(saver);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(product.name);
  const [description, setDescription] = useState(product.description ?? '');
  const [seoTitle, setSeoTitle] = useState(product.seoTitle ?? '');
  const [seoDescription, setSeoDescription] = useState(product.seoDescription ?? '');
  const [unitName, setUnitName] = useState(product.unitName);
  const [unitNamePlural, setUnitNamePlural] = useState(product.unitNamePlural);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const path = `/admin/products/${product.code}`;

  function startEditing() {
    setName(product.name);
    setDescription(product.description ?? '');
    setSeoTitle(product.seoTitle ?? '');
    setSeoDescription(product.seoDescription ?? '');
    setUnitName(product.unitName);
    setUnitNamePlural(product.unitNamePlural);
    setConfirmDelete(false);
  }

  /** Swaps places with the neighbour above (-1) or below (+1). */
  function move(direction: -1 | 1) {
    const other = neighbours[direction === -1 ? 0 : 1];
    if (!other) return;
    void save(async () => {
      await api(path, { method: 'PATCH', body: { sortOrder: other.sortOrder } });
      await api(`/admin/products/${other.code}`, { method: 'PATCH', body: { sortOrder: product.sortOrder } });
    }, 'Order updated');
  }

  return (
    <div className={`value-row ${product.isActive ? '' : 'value-hidden'}`}>
      <div className="value-summary">
        <div className="value-order">
          <button type="button" className="icon-btn" disabled={!neighbours[0] || saver.saving} onClick={() => move(-1)} aria-label="Move up">
            ↑
          </button>
          <button type="button" className="icon-btn" disabled={!neighbours[1] || saver.saving} onClick={() => move(1)} aria-label="Move down">
            ↓
          </button>
        </div>
        <div className="value-main">
          <div className="value-label">
            {product.name}
            {!product.isActive && <span className="badge">Hidden</span>}
          </div>
          {product.isActive ? (
            <a className="value-code" href={`${STOREFRONT_ORIGIN}/${product.code}`} target="_blank" rel="noreferrer">
              /{product.code} ↗
            </a>
          ) : (
            <code className="value-code">/{product.code}</code>
          )}
          {!product.isActive && product.setupIssue && <p className="value-issue">Not ready: {product.setupIssue}</p>}
        </div>
        <div className="value-actions">
          <button
            type="button"
            className="btn btn-small"
            onClick={() => {
              selectProduct(product.code);
              void navigate('/options');
            }}
          >
            Set up
          </button>
          <button
            type="button"
            className="btn btn-small"
            disabled={saver.saving || (!product.isActive && Boolean(product.setupIssue))}
            onClick={() =>
              void save(
                () => api(path, { method: 'PATCH', body: { isActive: !product.isActive } }),
                product.isActive ? 'Hidden from storefront' : 'Shown on storefront',
              )
            }
          >
            {product.isActive ? 'Hide' : 'Show'}
          </button>
          <button
            type="button"
            className="btn btn-small"
            aria-expanded={open}
            onClick={() => {
              if (!open) startEditing();
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
            void save(
              () =>
                api(path, {
                  method: 'PATCH',
                  body: {
                    name,
                    description: description.trim() || null,
                    seoTitle: seoTitle.trim() || null,
                    seoDescription: seoDescription.trim() || null,
                    unitName: unitName.trim(),
                    unitNamePlural: unitNamePlural.trim(),
                  },
                }),
              `${name.trim()} saved`,
            ).then((ok) => ok && setOpen(false));
          }}
        >
          <div className="form-grid">
            <label className="field">
              <span>Name (shown to customers)</span>
              <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} />
            </label>
            <label className="field">
              <span>SEO title (browser tab and search results)</span>
              <input value={seoTitle} onChange={(e) => setSeoTitle(e.target.value)} maxLength={70} placeholder="Uses the name" />
            </label>
            <UnitFields one={unitName} many={unitNamePlural} onOne={setUnitName} onMany={setUnitNamePlural} />
          </div>
          <label className="field">
            <span>Description (under the name on the product page)</span>
            <textarea className="textarea" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} />
          </label>
          <label className="field">
            <span>SEO description (search results)</span>
            <textarea
              className="textarea"
              rows={2}
              value={seoDescription}
              onChange={(e) => setSeoDescription(e.target.value)}
              maxLength={170}
              placeholder="Uses the description"
            />
          </label>
          <p className="muted">The URL /{product.code} cannot change, because search engines and open carts point to it.</p>
          <div className="form-actions">
            <button type="submit" className="btn btn-primary" disabled={saver.saving}>
              Save
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <span className="form-actions-spacer" />
            <button type="button" className="btn btn-ghost btn-danger-text" onClick={() => setConfirmDelete(true)}>
              Delete product
            </button>
          </div>
          {confirmDelete && (
            <div className="confirm-box" role="alert">
              <p>
                Delete <strong>{product.name}</strong>? Its options, prices, turnaround, templates and design packages are deleted too. Carts holding
                it ask the customer to choose again; placed orders are not affected. To take it off the storefront for a while, use Hide instead.
              </p>
              <div className="form-actions">
                <button
                  type="button"
                  className="btn btn-danger"
                  disabled={saver.saving}
                  onClick={() => void save(() => api(path, { method: 'DELETE' }), `${product.name} deleted`)}
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

/** The words the storefront uses for the product, e.g. "250 flyers · $0.20 each". */
function UnitFields({ one, many, onOne, onMany }: { one: string; many: string; onOne: (text: string) => void; onMany: (text: string) => void }) {
  return (
    <>
      <label className="field">
        <span>One item is called</span>
        <input value={one} onChange={(e) => onOne(e.target.value)} required maxLength={40} placeholder="flyer" />
      </label>
      <label className="field">
        <span>Several are called</span>
        <input value={many} onChange={(e) => onMany(e.target.value)} required maxLength={40} placeholder="flyers" />
      </label>
    </>
  );
}

function AddProduct({ saver }: { saver: Saver }) {
  const { products, selectProduct } = useCatalog();
  const save = useProductSave(saver);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [description, setDescription] = useState('');
  const [unitName, setUnitName] = useState('');
  const [unitNamePlural, setUnitNamePlural] = useState('');
  /** Empty: a blank product. */
  const [copyFrom, setCopyFrom] = useState('');
  const source = products.find((p) => p.code === copyFrom);

  if (!open) {
    return (
      <div className="value-row value-add">
        <button
          type="button"
          className="btn btn-small"
          onClick={() => {
            setName('');
            setCode('');
            setDescription('');
            setUnitName('');
            setUnitNamePlural('');
            setCopyFrom('');
            setOpen(true);
          }}
        >
          + Add product
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
          void save(async () => {
            const result = await api<{ code: string }>('/admin/products', {
              method: 'POST',
              body: {
                name: name.trim(),
                description: description.trim() || null,
                unitName: unitName.trim(),
                unitNamePlural: unitNamePlural.trim(),
                ...(code.trim() ? { code: code.trim() } : {}),
                ...(source ? { copyFrom: source.code } : {}),
              },
            });
            created = result.code;
          }, `${name.trim()} added. Set it up, then show it.`).then((ok) => {
            if (!ok) return;
            setOpen(false);
            selectProduct(created);
          });
        }}
      >
        <h3 className="form-subtitle">New product</h3>
        <div className="form-grid">
          <label className="field">
            <span>Name (shown to customers)</span>
            <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} autoFocus />
          </label>
          <label className="field">
            <span>URL (optional)</span>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.toLowerCase())}
              pattern="[a-z0-9]+(-[a-z0-9]+)*"
              title="Lowercase letters, numbers and dashes"
              maxLength={60}
              placeholder="Made from the name"
            />
          </label>
          <label className="field">
            <span>Start from</span>
            <select
              value={copyFrom}
              onChange={(e) => {
                const picked = products.find((p) => p.code === e.target.value);
                setCopyFrom(e.target.value);
                if (picked) {
                  setUnitName(picked.unitName);
                  setUnitNamePlural(picked.unitNamePlural);
                }
              }}
            >
              <option value="">Blank product</option>
              {products.map((p) => (
                <option key={p.code} value={p.code}>
                  Copy of {p.name}
                </option>
              ))}
            </select>
          </label>
          <UnitFields one={unitName} many={unitNamePlural} onOne={setUnitName} onMany={setUnitNamePlural} />
        </div>
        <label className="field">
          <span>Description (under the name on the product page)</span>
          <textarea className="textarea" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} />
        </label>
        <p className="muted">
          {source
            ? `The options, rules, quantities, prices, turnaround, templates and design packages of ${source.name} are copied. Later changes to one product do not touch the other.`
            : 'It starts with empty Size, Paper, Printed Side and Turnaround groups. Add your options, quantities and prices, then show it. Customers can upload their own files; templates come from copying a product that has them.'}
        </p>
        <div className="form-actions">
          <button type="submit" className="btn btn-primary" disabled={saver.saving || !name.trim() || !unitName.trim() || !unitNamePlural.trim()}>
            Add product
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
