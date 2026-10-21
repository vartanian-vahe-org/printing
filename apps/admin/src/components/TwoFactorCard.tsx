import QRCode from 'qrcode';
import { useState, type FormEvent } from 'react';
import { api, errorText } from '../api';
import { useAuth } from '../auth';

/** Account page: turn two-step sign-in on (scan, confirm a code) or off (password + code). */
export function TwoFactorCard({ onStatus }: { onStatus: (s: { kind: 'ok' | 'error'; text: string }) => void }) {
  const { user, refresh } = useAuth();
  const [setup, setSetup] = useState<{ secret: string; qr: string } | null>(null);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  async function run(action: () => Promise<void>, text: string) {
    setBusy(true);
    try {
      await action();
      await refresh();
      setCode('');
      setPassword('');
      onStatus({ kind: 'ok', text });
    } catch (err) {
      onStatus({ kind: 'error', text: errorText(err) });
    } finally {
      setBusy(false);
    }
  }

  async function start() {
    await run(async () => {
      const data = await api<{ secret: string; otpauthUri: string }>('/admin/auth/2fa/setup', { method: 'POST' });
      setSetup({ secret: data.secret, qr: await QRCode.toDataURL(data.otpauthUri, { margin: 1, width: 200 }) });
    }, 'Scan the code with your authenticator app');
  }

  function confirm(e: FormEvent) {
    e.preventDefault();
    void run(async () => {
      await api('/admin/auth/2fa/enable', { method: 'POST', body: { code } });
      setSetup(null);
    }, 'Two-step sign-in is on');
  }

  function turnOff(e: FormEvent) {
    e.preventDefault();
    void run(() => api('/admin/auth/2fa/disable', { method: 'POST', body: { password, code } }), 'Two-step sign-in is off');
  }

  return (
    <section className="card card-pad settings-card">
      <h2>Two-step sign-in</h2>
      {user?.twoFactorEnabled ? (
        <>
          <p className="muted">On. Signing in asks for a code from your authenticator app.</p>
          <form className="action-form" onSubmit={turnOff}>
            <div className="form-grid">
              <label className="field">
                <span>Password</span>
                <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
              </label>
              <label className="field">
                <span>Code from the app</span>
                <input inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
              </label>
            </div>
            <button type="submit" className="btn" disabled={busy || !password || code.length !== 6}>
              Turn off
            </button>
          </form>
        </>
      ) : setup ? (
        <form className="action-form" onSubmit={confirm}>
          <p className="muted">Scan this with Google Authenticator, 1Password or a similar app, then enter the code it shows.</p>
          <div className="totp-setup">
            <img src={setup.qr} alt="QR code for your authenticator app" width={200} height={200} />
            <div>
              <span className="muted-inline">Can't scan? Enter this key:</span>
              <code className="totp-key">{setup.secret.replace(/(.{4})/g, '$1 ').trim()}</code>
            </div>
          </div>
          <label className="field">
            <span>Code from the app</span>
            <input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} autoFocus />
          </label>
          <div className="form-actions">
            <button type="submit" className="btn btn-primary" disabled={busy || code.length !== 6}>
              Turn on
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setSetup(null)}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <>
          <p className="muted">Off. Recommended for owners and admins: a stolen password alone will not be enough to sign in.</p>
          <div className="form-actions">
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void start()}>
              Set up
            </button>
          </div>
        </>
      )}
    </section>
  );
}
