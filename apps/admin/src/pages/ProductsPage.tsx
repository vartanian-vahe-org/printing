import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { api, type AdminProduct } from '../api';
import { useCatalog, useSaver, type RegisterSave } from '../catalog';
import { Toast } from '../components/Toast';

type Saver = ReturnType<typeof useSaver>;

/** A save that also refreshes the product list. */
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
            Open a product to choose its options and set its prices. The storefront lists products in this order.
          </p>
        </div>
        <div className="header-actions">
          <Link className="btn btn-primary" to="/products/new">
            + Add product
          </Link>
        </div>
      </header>

      <div className="card">
        {products.map((product, index) => (
          <ProductRow key={product.code} product={product} neighbours={[products[index - 1], products[index + 1]]} saver={saver} />
        ))}
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
  const save = useProductSave(saver);
  const unfinished = !product.isActive && Boolean(product.setupIssue);

  /** Swaps places with the neighbour above (-1) or below (+1). */
  function move(direction: -1 | 1) {
    const other = neighbours[direction === -1 ? 0 : 1];
    if (!other) return;
    void save(async () => {
      await api(`/admin/products/${product.code}`, { method: 'PATCH', body: { sortOrder: other.sortOrder } });
      await api(`/admin/products/${other.code}`, { method: 'PATCH', body: { sortOrder: product.sortOrder } });
    }, 'Order updated');
  }

  return (
    <div className="value-row">
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
            <Link className="product-link" to={`/products/${product.code}`}>
              {product.name}
            </Link>
            {product.isActive ? <span className="badge badge-live">On the storefront</span> : <span className="badge">Hidden</span>}
            {unfinished && <span className="badge badge-rule">Setup not finished</span>}
          </div>
          <code className="value-code">/{product.code}</code>
        </div>
        <div className="value-actions">
          <Link className={`btn btn-small ${unfinished ? 'btn-primary' : ''}`} to={`/products/${product.code}${unfinished ? '/setup' : ''}`}>
            {unfinished ? 'Continue setup' : 'Manage'}
          </Link>
        </div>
      </div>
    </div>
  );
}

/** Name, page text, SEO and what customers call the product; used on this page and in the setup wizard. */
export function ProductDetailsForm({
  product,
  saver,
  register,
  actions,
  children,
}: {
  product: AdminProduct;
  saver: Saver;
  /** The setup wizard saves it on Next, so it shows no Save button. */
  register?: RegisterSave;
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
  const submit = () =>
    save(
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
    );
  useEffect(() => register?.('details', async () => (dirty ? submit() : true)));

  return (
    <form
      className="value-form"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
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
      {!register && (
        <div className="form-actions">
          <button type="submit" className="btn btn-primary" disabled={saver.saving}>
            Save
          </button>
          {actions}
        </div>
      )}
      {children}
    </form>
  );
}
