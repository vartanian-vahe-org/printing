import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { api, errorText } from '../api';

/** /reset#token: choose a new password from the emailed link (token in the fragment, never sent to a server log). */
export function ResetPasswordPage() {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (password !== confirm) {
      setError('The passwords do not match');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api('/admin/auth/password/reset', { method: 'POST', body: { token: window.location.hash.slice(1), newPassword: password } });
      setDone(true);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login">
      <form className="login-card" onSubmit={(e) => void submit(e)}>
        <h1>Choose a new password</h1>
        {done ? (
          <>
            <p className="muted">Your password is changed. You were signed out on other devices.</p>
            <Link to="/login" className="btn btn-primary">
              Sign in
            </Link>
          </>
        ) : (
          <>
            <label className="field">
              <span>New password</span>
              <input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 12 characters" required />
            </label>
            <label className="field">
              <span>Repeat new password</span>
              <input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
            </label>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <button type="submit" className="btn btn-primary" disabled={busy || password.length < 12}>
              {busy ? 'Saving…' : 'Save password'}
            </button>
          </>
        )}
      </form>
    </div>
  );
}
