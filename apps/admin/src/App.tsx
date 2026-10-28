import { BrowserRouter, Navigate, NavLink, Outlet, Route, Routes, useLocation } from 'react-router';
import { AuthProvider, useAuth } from './auth';
import { CatalogProvider, useCatalog } from './catalog';
import { AccountPage } from './pages/AccountPage';
import { ActivityPage } from './pages/ActivityPage';
import { LoginPage } from './pages/LoginPage';
import { ResetPasswordPage } from './pages/ResetPasswordPage';
import { OptionsPage } from './pages/OptionsPage';
import { OrderDetailPage } from './pages/OrderDetailPage';
import { OrdersPage } from './pages/OrdersPage';
import { PricingPage } from './pages/PricingPage';
import { RulesPage } from './pages/RulesPage';
import { SettingsPage } from './pages/SettingsPage';
import { StaffPage } from './pages/StaffPage';
import { TemplatesPage } from './pages/TemplatesPage';
import { DesignServicesPage } from './pages/DesignServicesPage';
import { isHiddenPath } from './features';

const STOREFRONT_URL = import.meta.env.VITE_STOREFRONT_URL ?? 'http://localhost:3000/business-cards';

const ROUTES = [
  { path: '/orders', element: <OrdersPage /> },
  { path: '/orders/:number', element: <OrderDetailPage /> },
  { path: '/options', element: <OptionsPage /> },
  { path: '/rules', element: <RulesPage /> },
  { path: '/pricing', element: <PricingPage /> },
  { path: '/templates', element: <TemplatesPage /> },
  { path: '/design-services', element: <DesignServicesPage /> },
  { path: '/settings', element: <SettingsPage /> },
  { path: '/staff', element: <StaffPage /> },
  { path: '/activity', element: <ActivityPage /> },
  { path: '/account', element: <AccountPage /> },
];

/** Landing page after sign-in: Orders, or Options while orders are hidden (features.ts). */
const HOME = isHiddenPath('/orders') ? '/options' : '/orders';

export function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/reset" element={<ResetPasswordPage />} />
          <Route element={<RequireAuth />}>
            <Route index element={<Navigate to={HOME} replace />} />
            {ROUTES.filter((route) => !isHiddenPath(route.path)).map((route) => (
              <Route key={route.path} path={route.path} element={route.element} />
            ))}
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}

function RequireAuth() {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <p className="page-loading">Loading…</p>;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return (
    <CatalogProvider>
      <Layout />
    </CatalogProvider>
  );
}

type Role = 'owner' | 'admin' | 'staff';

/** Sidebar, grouped; `roles` hides links a role cannot use (the API enforces it too), features.ts hides unreleased pages. */
const NAV: { section?: string; product?: true; items: { to: string; label: string; hint: string; roles?: Role[] }[] }[] = [
  { items: [{ to: '/orders', label: 'Orders', hint: 'Payments, printing, shipping' }] },
  {
    // Configuration of the product picked in the sidebar (Business Cards, Postcards…).
    product: true,
    items: [
      { to: '/options', label: 'Options', hint: 'Sizes, papers, coatings…' },
      { to: '/rules', label: 'Rules', hint: 'Which options go together' },
      { to: '/pricing', label: 'Pricing', hint: 'Base prices and upcharges' },
      { to: '/templates', label: 'Templates', hint: 'Designs and their filters' },
      { to: '/design-services', label: 'Design services', hint: 'Packages we design for you' },
    ],
  },
  {
    section: 'Shop',
    items: [
      { to: '/settings', label: 'Settings', hint: 'Store, cutoff, holidays', roles: ['owner', 'admin'] },
      { to: '/staff', label: 'Staff', hint: 'Who can sign in', roles: ['owner'] },
      { to: '/activity', label: 'Activity', hint: 'Who changed what', roles: ['owner', 'admin'] },
    ],
  },
];

function Layout() {
  const { user, logout } = useAuth();
  const { error, products, product, selectProduct } = useCatalog();
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="sidebar-brand">Print Studio Admin</div>
        <nav>
          {NAV.map((group, i) => {
            const items = group.items.filter(
              (item) => !isHiddenPath(item.to) && (!item.roles || (user && item.roles.includes(user.role))),
            );
            if (items.length === 0) return null;
            return (
              <div key={group.section ?? i}>
                {group.product ? (
                  <ProductPicker products={products} current={product?.code ?? ''} onChange={selectProduct} />
                ) : (
                  group.section && <div className="sidebar-product">{group.section}</div>
                )}
                {items.map((item) => (
                  <NavLink key={item.to} to={item.to} className={({ isActive }) => `nav-item ${isActive ? 'nav-active' : ''}`}>
                    <span>{item.label}</span>
                    <small>{item.hint}</small>
                  </NavLink>
                ))}
              </div>
            );
          })}
        </nav>
        <div className="sidebar-footer">
          <a href={STOREFRONT_URL} target="_blank" rel="noreferrer" className="sidebar-link">
            View storefront ↗
          </a>
          <NavLink to="/account" className="sidebar-user">
            <span>{user?.name}</span>
            <small>
              {user?.email} · {user?.role} · password
            </small>
          </NavLink>
          <button type="button" className="btn btn-ghost" onClick={() => void logout()}>
            Sign out
          </button>
        </div>
      </aside>
      <main className="content">
        {error && <div className="banner banner-error">Could not load settings: {error}</div>}
        <Outlet key={product?.code} />
      </main>
    </div>
  );
}

/** Section title of the product pages; a picker once there is more than one product. */
function ProductPicker({ products, current, onChange }: { products: { code: string; name: string }[]; current: string; onChange: (code: string) => void }) {
  const name = products.find((p) => p.code === current)?.name ?? 'Product';
  if (products.length <= 1) return <div className="sidebar-product">{name}</div>;
  return (
    <label className="sidebar-product sidebar-product-picker">
      <span className="visually-hidden">Product</span>
      <select value={current} onChange={(e) => onChange(e.target.value)}>
        {products.map((p) => (
          <option key={p.code} value={p.code}>
            {p.name}
          </option>
        ))}
      </select>
    </label>
  );
}
