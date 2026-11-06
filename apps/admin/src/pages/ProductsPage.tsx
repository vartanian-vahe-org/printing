import { useEffect, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
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
        <div className="value-row value-add">
          <Link className="btn btn-small" to="/products/new">
            + Add product
          </Link>
        </div>
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
  const navigate = useNavigate();
  const save = useProductSave(saver);
  const [open, setOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const path = `/admin/products/${product.code}`;
  const unfinished = !product.isActive && Boolean(product.setupIssue);

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
            {unfinished && <span className="badge badge-rule">Setup not finished</span>}
          </div>
          {product.isActive ? (
            <a className="value-code" href={`${STOREFRONT_ORIGIN}/${product.code}`} target="_blank" rel="noreferrer">
              /{product.code} ↗
            </a>
          ) : (
            <code className="value-code">/{product.code}</code>
          )}
        </div>
        <div className="value-actions">
          <button
            type="button"
            className={`btn btn-small ${unfinished ? 'btn-primary' : ''}`}
            onClick={() => void navigate(`/products/${product.code}/setup${unfinished ? '' : '/size'}`)}
          >
            {unfinished ? 'Continue setup' : 'Set up'}
          </button>
          {!unfinished && (
            <button
              type="button"
              className="btn btn-small"
              disabled={saver.saving}
              onClick={() =>
                void save(
                  () => api(path, { method: 'PATCH', body: { isActive: !product.isActive } }),
                  product.isActive ? 'Hidden from storefront' : 'Shown on storefront',
                )
              }
            >
              {product.isActive ? 'Hide' : 'Show'}
            </button>
          )}
          <button
            type="button"
            className="btn btn-small"
            aria-expanded={open}
            onClick={() => {
              setConfirmDelete(false);
              setOpen(!open);
            }}
          >
            {open ? 'Close' : 'Edit'}
          </button>
        </div>
      </div>

      {open && (
        <ProductDetailsForm
          product={product}
          saver={saver}
          onSaved={() => setOpen(false)}
          actions={
            <>
              <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>
                Cancel
              </button>
              <span className="form-actions-spacer" />
              <button type="button" className="btn btn-ghost btn-danger-text" onClick={() => setConfirmDelete(true)}>
                Delete product
              </button>
            </>
          }
        >
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
        </ProductDetailsForm>
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

/** Name, page text, SEO and what customers call the product; used on this page and in the setup wizard. */
export function ProductDetailsForm({
  product,
  saver,
  onSaved,
  onDirty,
  actions,
  children,
}: {
  product: AdminProduct;
  saver: Saver;
  onSaved?: () => void;
  onDirty?: (dirty: boolean) => void;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  const save = useProductSave(saver);
  const [name, setName] = useState(product.name);
  const [description, setDescription] = useState(product.description ?? '');
  const [seoTitle, setSeoTitle] = useState(product.seoTitle ?? '');
  const [seoDescription, setSeoDescription] = useState(product.seoDescription ?? '');
  const [unitName, setUnitName] = useState(product.unitName);
  const [unitNamePlural, setUnitNamePlural] = useState(product.unitNamePlural);
  const dirty =
    name !== product.name ||
    description !== (product.description ?? '') ||
    seoTitle !== (product.seoTitle ?? '') ||
    seoDescription !== (product.seoDescription ?? '') ||
    unitName !== product.unitName ||
    unitNamePlural !== product.unitNamePlural;
  useEffect(() => onDirty?.(dirty), [dirty, onDirty]);

  return (
    <form
      className="value-form"
      onSubmit={(e) => {
        e.preventDefault();
        void save(
          () =>
            api(`/admin/products/${product.code}`, {
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
        ).then((ok) => ok && onSaved?.());
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
        <label className="field">
          <span>One item is called (e.g. "250 flyers")</span>
          <input value={unitName} onChange={(e) => setUnitName(e.target.value)} required maxLength={40} />
        </label>
        <label className="field">
          <span>Several are called</span>
          <input value={unitNamePlural} onChange={(e) => setUnitNamePlural(e.target.value)} required maxLength={40} />
        </label>
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
        {actions}
      </div>
      {children}
    </form>
  );
}
