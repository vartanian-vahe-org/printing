import { BrowserRouter, Navigate, NavLink, Outlet, Route, Routes, useLocation } from 'react-router';
import { AuthProvider, useAuth } from './auth';
import { CatalogProvider, useCatalog } from './catalog';
import { LoginPage } from './pages/LoginPage';
import { OptionsPage } from './pages/OptionsPage';
import { PricingPage } from './pages/PricingPage';
import { RulesPage } from './pages/RulesPage';
import { TemplatesPage } from './pages/TemplatesPage';

const STOREFRONT_URL = import.meta.env.VITE_STOREFRONT_URL ?? 'http://localhost:3000/business-cards';

export function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route element={<RequireAuth />}>
            <Route index element={<Navigate to="/options" replace />} />
            <Route path="/options" element={<OptionsPage />} />
            <Route path="/rules" element={<RulesPage />} />
            <Route path="/pricing" element={<PricingPage />} />
            <Route path="/templates" element={<TemplatesPage />} />
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

const NAV = [
  { to: '/options', label: 'Options', hint: 'Sizes, papers, coatings…' },
  { to: '/rules', label: 'Rules', hint: 'Which options go together' },
  { to: '/pricing', label: 'Pricing', hint: 'Base prices and upcharges' },
  { to: '/templates', label: 'Templates', hint: 'Show or hide designs' },
];

function Layout() {
  const { user, logout } = useAuth();
  const { error } = useCatalog();
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="sidebar-brand">Print Studio Admin</div>
        <div className="sidebar-product">Business Cards</div>
        <nav>
          {NAV.map((item) => (
            <NavLink key={item.to} to={item.to} className={({ isActive }) => `nav-item ${isActive ? 'nav-active' : ''}`}>
              <span>{item.label}</span>
              <small>{item.hint}</small>
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-footer">
          <a href={STOREFRONT_URL} target="_blank" rel="noreferrer" className="sidebar-link">
            View storefront ↗
          </a>
          <div className="sidebar-user">
            <span>{user?.name}</span>
            <small>
              {user?.email} · {user?.role}
            </small>
          </div>
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
