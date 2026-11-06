import { BrowserRouter, Navigate, NavLink, Outlet, Route, Routes, useLocation } from 'react-router';
import { AuthProvider, useAuth } from './auth';
import { CatalogProvider, STOREFRONT_ORIGIN, useCatalog } from './catalog';
import { AccountPage } from './pages/AccountPage';
import { ActivityPage } from './pages/ActivityPage';
import { LoginPage } from './pages/LoginPage';
import { ResetPasswordPage } from './pages/ResetPasswordPage';
import { OptionsPage } from './pages/OptionsPage';
import { OrderDetailPage } from './pages/OrderDetailPage';
import { OrdersPage } from './pages/OrdersPage';
import { SettingsPage } from './pages/SettingsPage';
import { ProductPage } from './pages/ProductPage';
import { NewProductPage, ProductSetupPage } from './pages/ProductSetupPage';
import { ProductsPage } from './pages/ProductsPage';
import { StaffPage } from './pages/StaffPage';
import { isHiddenPath } from './features';

const ROUTES = [
  { path: '/orders', element: <OrdersPage /> },
  { path: '/orders/:number', element: <OrderDetailPage /> },
  { path: '/products', element: <ProductsPage /> },
  { path: '/products/new', element: <NewProductPage /> },
  { path: '/products/:code/setup/:step?', element: <ProductSetupPage /> },
  { path: '/products/:code/:tab?', element: <ProductPage /> },
  { path: '/options', element: <OptionsPage /> },
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
const NAV: { section?: string; items: { to: string; label: string; hint: string; roles?: Role[] }[] }[] = [
  {
    items: [
      { to: '/orders', label: 'Orders', hint: 'Payments, printing, shipping' },
      { to: '/products', label: 'Products', hint: 'Options and prices of each' },
      { to: '/options', label: 'Option library', hint: 'Shared by all products' },
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
  const { error } = useCatalog();
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
                {group.section && <div className="sidebar-product">{group.section}</div>}
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
          <a href={STOREFRONT_ORIGIN} target="_blank" rel="noreferrer" className="sidebar-link">
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
        <Outlet />
      </main>
    </div>
  );
}
