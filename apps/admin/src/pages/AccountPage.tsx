import { useState, type FormEvent } from 'react';
import { api, errorText } from '../api';
import { useAuth } from '../auth';
import { Toast } from '../components/Toast';
import { TwoFactorCard } from '../components/TwoFactorCard';

/** The signed-in person's own account: change password. */
export function AccountPage() {
  const { user } = useAuth();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (next !== confirm) {
      setStatus({ kind: 'error', text: 'The new passwords do not match' });
      return;
    }
    setBusy(true);
    try {
      await api('/admin/auth/password', { method: 'POST', body: { currentPassword: current, newPassword: next } });
      setCurrent('');
      setNext('');
      setConfirm('');
      setStatus({ kind: 'ok', text: 'Password changed. Other devices were signed out.' });
    } catch (err) {
      setStatus({ kind: 'error', text: errorText(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>Account</h1>
          <p className="muted">
            {user?.name} · {user?.email} · {user?.role}
          </p>
        </div>
      </header>
      <form className="card card-pad settings-card" onSubmit={(e) => void submit(e)}>
        <h2>Change password</h2>
        <label className="field">
          <span>Current password</span>
          <input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
        </label>
        <div className="form-grid">
          <label className="field">
            <span>New password</span>
            <input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} placeholder="At least 12 characters" />
          </label>
          <label className="field">
            <span>Repeat new password</span>
            <input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </label>
        </div>
        <div className="form-actions">
          <button type="submit" className="btn btn-primary" disabled={busy || !current || next.length < 12}>
            Change password
          </button>
        </div>
      </form>
      <TwoFactorCard onStatus={setStatus} />
      <Toast status={status} onClose={() => setStatus(null)} />
    </div>
  );
}
