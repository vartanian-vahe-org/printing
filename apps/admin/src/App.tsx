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

const STOREFRONT_URL = import.meta.env.VITE_STOREFRONT_URL ?? 'http://localhost:3000/business-cards';

export function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/reset" element={<ResetPasswordPage />} />
          <Route element={<RequireAuth />}>
            <Route index element={<Navigate to="/orders" replace />} />
            <Route path="/orders" element={<OrdersPage />} />
            <Route path="/orders/:number" element={<OrderDetailPage />} />
            <Route path="/options" element={<OptionsPage />} />
            <Route path="/rules" element={<RulesPage />} />
            <Route path="/pricing" element={<PricingPage />} />
            <Route path="/templates" element={<TemplatesPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/staff" element={<StaffPage />} />
            <Route path="/activity" element={<ActivityPage />} />
            <Route path="/account" element={<AccountPage />} />
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

/** Sidebar, grouped; `roles` hides links a role cannot use (the API enforces it too). */
const NAV: { section?: string; items: { to: string; label: string; hint: string; roles?: Role[] }[] }[] = [
  { items: [{ to: '/orders', label: 'Orders', hint: 'Payments, printing, shipping' }] },
  {
    section: 'Business Cards',
    items: [
      { to: '/options', label: 'Options', hint: 'Sizes, papers, coatings…' },
      { to: '/rules', label: 'Rules', hint: 'Which options go together' },
      { to: '/pricing', label: 'Pricing', hint: 'Base prices and upcharges' },
      { to: '/templates', label: 'Templates', hint: 'Show or hide designs' },
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
            const items = group.items.filter((item) => !item.roles || (user && item.roles.includes(user.role)));
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
        <Outlet />
      </main>
    </div>
  );
}
