import { useEffect, useState } from 'react';
import { Link, Navigate, NavLink, useNavigate, useParams } from 'react-router';
import { api, type AdminProduct } from '../api';
import { STOREFRONT_ORIGIN, useCatalog, useSaver } from '../catalog';
import { Toast } from '../components/Toast';
import { DesignServicesPage } from './DesignServicesPage';
import { PricingPage } from './PricingPage';
import { ProductOptionsPage } from './ProductOptionsPage';
import { ProductDetailsForm } from './ProductsPage';
import { RulesPage } from './RulesPage';
import { TemplatesPage } from './TemplatesPage';
import { TurnaroundPage } from './TurnaroundPage';

const TABS = [
  { path: 'options', label: 'Options', element: <ProductOptionsPage /> },
  { path: 'prices', label: 'Prices', element: <PricingPage /> },
  { path: 'turnaround', label: 'Turnaround', element: <TurnaroundPage /> },
  { path: 'rules', label: 'Rules', element: <RulesPage /> },
  { path: 'templates', label: 'Templates', element: <TemplatesPage /> },
  { path: 'design-services', label: 'Design services', element: <DesignServicesPage /> },
  { path: 'details', label: 'Details', element: <DetailsTab /> },
];

/** One product: everything that belongs to it, on its own page with its name at the top. */
export function ProductPage() {
  const { code = '', tab } = useParams();
  const { catalog, product, products, reloadProducts, selectProduct } = useCatalog();
  const saver = useSaver();

  useEffect(() => selectProduct(code), [code, selectProduct]);

  if (products.length > 0 && !products.some((p) => p.code === code)) return <Navigate to="/products" replace />;
  if (!catalog || !product || product.code !== code || catalog.product.code !== code) return <p className="page-loading">Loading…</p>;
  const current = TABS.find((t) => t.path === tab);
  if (!current) return <Navigate to={`/products/${code}/options`} replace />;

  const unfinished = !product.isActive && Boolean(product.setupIssue);

  return (
    <div className="page">
      <Link className="back-link" to="/products">
        ← All products
      </Link>
      <header className="page-header product-header">
        <h1>
          {product.name}
          {product.isActive ? <span className="badge badge-live">On the storefront</span> : <span className="badge">Hidden</span>}
          {unfinished && <span className="badge badge-rule">Setup not finished</span>}
        </h1>
        <div className="header-actions">
          {product.isActive && (
            <a className="btn" href={`${STOREFRONT_ORIGIN}/${product.code}`} target="_blank" rel="noreferrer">
              View on storefront ↗
            </a>
          )}
          {unfinished ? (
            <Link className="btn btn-primary" to={`/products/${code}/setup`}>
              Continue setup
            </Link>
          ) : (
            <button
              type="button"
              className="btn"
              disabled={saver.saving}
              onClick={() =>
                void saver.save(async () => {
                  await api(`/admin/products/${code}`, { method: 'PATCH', body: { isActive: !product.isActive } });
                  await reloadProducts();
                }, product.isActive ? 'Hidden from storefront' : 'Shown on storefront')
              }
            >
              {product.isActive ? 'Hide from storefront' : 'Show on storefront'}
            </button>
          )}
        </div>
      </header>

      <nav className="product-tabs" aria-label={`${product.name} settings`}>
        {TABS.map((t) => (
          <NavLink key={t.path} to={`/products/${code}/${t.path}`} className={({ isActive }) => `product-tab ${isActive ? 'product-tab-active' : ''}`}>
            {t.label}
          </NavLink>
        ))}
      </nav>

      <div key={`${code}.${current.path}`} className="product-tab-body">
        {current.element}
      </div>
      <Toast status={saver.status} onClose={saver.clearStatus} />
    </div>
  );
}

function DetailsTab() {
  const { product } = useCatalog();
  return product ? <Details product={product} /> : null;
}

/** Name, texts and URL of the product, and deleting it. */
function Details({ product }: { product: AdminProduct }) {
  const { reloadProducts } = useCatalog();
  const navigate = useNavigate();
  const saver = useSaver();
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <>
      <div className="card">
        <ProductDetailsForm
          product={product}
          saver={saver}
          actions={
            <>
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
                Delete <strong>{product.name}</strong>? Its prices, turnaround, templates and design packages are deleted too; options stay in the
                library. Carts holding it ask the customer to choose again; placed orders are not affected. To take it off the storefront for a while,
                use Hide instead.
              </p>
              <div className="form-actions">
                <button
                  type="button"
                  className="btn btn-danger"
                  disabled={saver.saving}
                  onClick={() =>
                    void saver
                      .save(async () => {
                        await api(`/admin/products/${product.code}`, { method: 'DELETE' });
                        await reloadProducts();
                      }, `${product.name} deleted`)
                      .then((ok) => ok && navigate('/products'))
                  }
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
      </div>
      <Toast status={saver.status} onClose={saver.clearStatus} />
    </>
  );
}
