import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, errorText } from '../api';
import { useAuth } from '../auth';
import { Toast } from '../components/Toast';
import { shopDateTime } from '../orders';

type Role = 'owner' | 'admin' | 'staff';
interface StaffMember {
  id: string;
  email: string;
  name: string;
  role: Role;
  isActive: boolean;
  lastLoginAt: string | null;
  twoFactorEnabled: boolean;
  createdAt: string;
}

const ROLE_HINTS: Record<Role, string> = {
  owner: 'Everything, including staff accounts',
  admin: 'Orders, products, prices and settings',
  staff: 'Production floor: print, ship, notes; no payments or cancellations',
};

/** Staff accounts (the owner only). */
export function StaffPage() {
  const { user } = useAuth();
  const [staff, setStaff] = useState<StaffMember[] | null>(null);
  const [status, setStatus] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [resetFor, setResetFor] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setStaff((await api<{ staff: StaffMember[] }>('/admin/staff')).staff);
    } catch (err) {
      setStatus({ kind: 'error', text: errorText(err) });
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function run(action: () => Promise<unknown>, text: string) {
    setBusy(true);
    try {
      await action();
      await load();
      setStatus({ kind: 'ok', text });
      return true;
    } catch (err) {
      setStatus({ kind: 'error', text: errorText(err) });
      return false;
    } finally {
      setBusy(false);
    }
  }

  if (!staff) return <p className="page-loading">{status?.text ?? 'Loading…'}</p>;
  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>Staff</h1>
          <p className="muted">Who can sign in to this admin. Disabling an account or changing its role signs that person out.</p>
        </div>
      </header>

      <section className="card">
        <table className="orders-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Role</th>
              <th>Last sign-in</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {staff.map((member) => (
              <tr key={member.id} className={member.isActive ? undefined : 'row-past'}>
                <td>
                  <div>
                    {member.name}
                    {member.email === user?.email && <span className="badge">you</span>}
                    {member.twoFactorEnabled && <span className="badge badge-default">2FA</span>}
                  </div>
                  <small className="muted-inline">{member.email}</small>
                </td>
                <td>
                  <select
                    value={member.role}
                    disabled={busy}
                    onChange={(e) => void run(() => api(`/admin/staff/${member.id}`, { method: 'PATCH', body: { role: e.target.value } }), 'Role changed')}
                    title={ROLE_HINTS[member.role]}
                  >
                    {(Object.keys(ROLE_HINTS) as Role[]).map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                </td>
                <td>{member.lastLoginAt ? shopDateTime(member.lastLoginAt) : <span className="muted-inline">never</span>}</td>
                <td>{member.isActive ? 'Active' : 'Disabled'}</td>
                <td className="num">
                  <button
                    type="button"
                    className="link-btn"
                    disabled={busy}
                    onClick={() => void run(() => api(`/admin/staff/${member.id}`, { method: 'PATCH', body: { isActive: !member.isActive } }), member.isActive ? 'Account disabled' : 'Account enabled')}
                  >
                    {member.isActive ? 'Disable' : 'Enable'}
                  </button>
                  {' · '}
                  <button type="button" className="link-btn" onClick={() => setResetFor(resetFor === member.id ? null : member.id)}>
                    New password
                  </button>
                  {member.twoFactorEnabled && (
                    <>
                      {' · '}
                      <button
                        type="button"
                        className="link-btn"
                        disabled={busy}
                        title="For a lost phone: they sign in with the password and set it up again"
                        onClick={() => void run(() => api(`/admin/staff/${member.id}/2fa/reset`, { method: 'POST' }), `Two-step sign-in turned off for ${member.name}`)}
                      >
                        Reset 2FA
                      </button>
                    </>
                  )}
                  {resetFor === member.id && (
                    <PasswordForm
                      busy={busy}
                      onSubmit={(password) =>
                        run(() => api(`/admin/staff/${member.id}/password`, { method: 'POST', body: { password } }), `New password set for ${member.name}`).then(
                          (ok) => ok && setResetFor(null),
                        )
                      }
                    />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <AddStaff busy={busy} onAdd={(body) => run(() => api('/admin/staff', { method: 'POST', body }), `${body.name} added`)} />
      <section className="card card-pad">
        <h2>Roles</h2>
        <ul className="role-list">
          {(Object.keys(ROLE_HINTS) as Role[]).map((r) => (
            <li key={r}>
              <strong>{r}</strong>: {ROLE_HINTS[r]}
            </li>
          ))}
        </ul>
      </section>
      <Toast status={status} onClose={() => setStatus(null)} />
    </div>
  );
}

function PasswordForm({ busy, onSubmit }: { busy: boolean; onSubmit: (password: string) => void }) {
  const [password, setPassword] = useState('');
  return (
    <form
      className="note-form inline-password"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(password);
      }}
    >
      <input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 12 characters" aria-label="New password" />
      <button type="submit" className="btn btn-small" disabled={busy || password.length < 12}>
        Set
      </button>
    </form>
  );
}

function AddStaff({ busy, onAdd }: { busy: boolean; onAdd: (body: { email: string; name: string; role: Role; password: string }) => Promise<boolean> }) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<Role>('staff');
  const [password, setPassword] = useState('');
  function submit(e: FormEvent) {
    e.preventDefault();
    void onAdd({ email: email.trim(), name: name.trim(), role, password }).then((ok) => ok && (setEmail(''), setName(''), setPassword('')));
  }
  return (
    <form className="card card-pad settings-card" onSubmit={submit}>
      <h2>Add a person</h2>
      <p className="muted">Give them the password yourself; they can change it under Account after signing in.</p>
      <div className="form-grid">
        <label className="field">
          <span>Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={100} />
        </label>
        <label className="field">
          <span>Email</span>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="field">
          <span>Role</span>
          <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
            {(Object.keys(ROLE_HINTS) as Role[]).map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>First password</span>
          <input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 12 characters" />
        </label>
      </div>
      <div className="form-actions">
        <button type="submit" className="btn btn-primary" disabled={busy || !email.trim() || !name.trim() || password.length < 12}>
          Add account
        </button>
      </div>
    </form>
  );
}
