import { useEffect, useState } from 'react';
import { api, errorText } from '../api';
import { shopDateTime } from '../orders';

interface AuditEntry {
  id: string;
  actor: string;
  action: string;
  target: string;
  summary: string;
  changes: Record<string, unknown> | null;
  createdAt: string;
}

const AREAS = [
  { value: '', label: 'Everything' },
  { value: 'catalog', label: 'Products & prices' },
  { value: 'settings', label: 'Settings' },
  { value: 'staff', label: 'Staff' },
  { value: 'auth', label: 'Passwords' },
];

/** Who changed what in the admin (orders have their own history on each order). */
export function ActivityPage() {
  const [area, setArea] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ entries: AuditEntry[]; total: number; pageSize: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    const query = new URLSearchParams({ page: String(page), ...(area ? { area } : {}) });
    api<{ entries: AuditEntry[]; total: number; pageSize: number }>(`/admin/audit?${query}`)
      .then((d) => (setData(d), setError(null)))
      .catch((err: unknown) => setError(errorText(err)));
  }, [area, page]);

  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  return (
    <div className="page page-wide">
      <header className="page-header">
        <div>
          <h1>Activity</h1>
          <p className="muted">Changes to products, prices, settings and staff accounts. Order history is on each order.</p>
        </div>
      </header>
      <div className="tabs">
        {AREAS.map((a) => (
          <button key={a.value} type="button" className={`tab ${area === a.value ? 'tab-active' : ''}`} onClick={() => (setArea(a.value), setPage(1))}>
            {a.label}
          </button>
        ))}
      </div>
      {error && <div className="banner banner-error">{error}</div>}
      <div className="card">
        <table className="orders-table">
          <thead>
            <tr>
              <th>When</th>
              <th>Who</th>
              <th>What</th>
              <th>Change</th>
            </tr>
          </thead>
          <tbody>
            {data?.entries.map((e) => (
              <tr key={e.id} className={e.changes ? 'clickable' : undefined} onClick={() => e.changes && setOpen(open === e.id ? null : e.id)}>
                <td>{shopDateTime(e.createdAt)}</td>
                <td>{e.actor.replace(/ <.*>$/, '')}</td>
                <td>
                  <div>{e.target}</div>
                  <small className="muted-inline">{e.action}</small>
                </td>
                <td>
                  {e.summary}
                  {open === e.id && e.changes && <pre className="changes">{JSON.stringify(e.changes, null, 2)}</pre>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {data && data.entries.length === 0 && <p className="empty-note">Nothing recorded yet.</p>}
      </div>
      {pages > 1 && (
        <div className="pager">
          <button type="button" className="btn btn-small" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            ← Newer
          </button>
          <span className="muted-inline">
            Page {page} of {pages}
          </span>
          <button type="button" className="btn btn-small" disabled={page >= pages} onClick={() => setPage(page + 1)}>
            Older →
          </button>
        </div>
      )}
    </div>
  );
}
