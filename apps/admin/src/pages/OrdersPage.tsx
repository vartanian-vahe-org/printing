import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { api, errorText } from '../api';
import { ShipBy } from '../components/ShipBy';
import { money, ORDER_VIEW_TABS, PAYMENT_LABELS, shopDateTime, STATUS_LABELS, type OrderList, type OrderListView } from '../orders';

export function OrdersPage() {
  const [params, setParams] = useSearchParams();
  const view = (params.get('view') as OrderListView | null) ?? 'needs_payment';
  const q = params.get('q') ?? '';
  const page = Number(params.get('page') ?? 1);
  const [search, setSearch] = useState(q);
  const [data, setData] = useState<OrderList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;
    const query = new URLSearchParams({ view, page: String(page), ...(q ? { q } : {}) });
    api<OrderList>(`/admin/orders?${query}`)
      .then((d) => !cancelled && (setData(d), setError(null)))
      .catch((err: unknown) => !cancelled && setError(errorText(err)));
    return () => {
      cancelled = true;
    };
  }, [view, q, page]);

  // Search as you type, a moment after the last key.
  useEffect(() => {
    if (search === q) return;
    const timer = setTimeout(() => update({ q: search || null, page: null }), 300);
    return () => clearTimeout(timer);
  });

  function update(patch: Record<string, string | null>) {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(patch)) {
      if (value === null) next.delete(key);
      else next.set(key, value);
    }
    setParams(next, { replace: true });
  }

  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div className="page page-wide">
      <header className="page-header">
        <div>
          <h1>Orders</h1>
          <p className="muted">Record payments, move orders into production and add tracking.</p>
        </div>
        <input
          className="search"
          type="search"
          placeholder="Order #, email or name"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search orders"
        />
      </header>

      <div className="tabs">
        {ORDER_VIEW_TABS.map((tab) => (
          <button
            key={tab.view}
            type="button"
            className={`tab ${view === tab.view ? 'tab-active' : ''}`}
            onClick={() => update({ view: tab.view, page: null })}
          >
            {tab.label}
            {data && <span className="tab-count">{data.counts[tab.view]}</span>}
          </button>
        ))}
      </div>

      {error && <div className="banner banner-error">{error}</div>}

      <div className="card">
        <table className="orders-table">
          <thead>
            <tr>
              <th>Order</th>
              <th>Placed</th>
              <th>Customer</th>
              <th className="num">Items</th>
              <th className="num">Total</th>
              <th>Payment</th>
              <th>Status</th>
              <th>Ship by</th>
            </tr>
          </thead>
          <tbody>
            {data?.orders.map((o) => (
              <tr key={o.number} onClick={() => navigate(`/orders/${o.number}`)} className="clickable">
                <td>
                  <Link to={`/orders/${o.number}`} onClick={(e) => e.stopPropagation()}>
                    #{o.number}
                  </Link>
                </td>
                <td>{shopDateTime(o.placedAt)}</td>
                <td>
                  <div>{o.name}</div>
                  <small className="muted-inline">
                    {o.email} · {o.state}
                  </small>
                </td>
                <td className="num">{o.itemCount}</td>
                <td className="num">{money(o.totalCents)}</td>
                <td>
                  <span className={`pill pill-pay-${o.paymentStatus}`}>{PAYMENT_LABELS[o.paymentStatus] ?? o.paymentStatus}</span>
                  {o.status === 'cancelled' && o.paymentStatus === 'paid' && <span className="pill pill-warn">Refund due</span>}
                </td>
                <td>
                  <span className={`pill pill-status-${o.status}`}>{STATUS_LABELS[o.status] ?? o.status}</span>
                </td>
                <td>
                  <ShipBy shipBy={o.shipBy} status={o.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {data && data.orders.length === 0 && <p className="empty-note">No orders here.</p>}
        {!data && !error && <p className="empty-note">Loading…</p>}
      </div>

      {data && pages > 1 && (
        <div className="pager">
          <button type="button" className="btn btn-small" disabled={page <= 1} onClick={() => update({ page: String(page - 1) })}>
            ← Newer
          </button>
          <span className="muted-inline">
            Page {page} of {pages}
          </span>
          <button type="button" className="btn btn-small" disabled={page >= pages} onClick={() => update({ page: String(page + 1) })}>
            Older →
          </button>
        </div>
      )}
    </div>
  );
}
