import { useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router';
import { api, errorText } from '../api';
import { useAuth } from '../auth';

type Step = { kind: 'password' } | { kind: 'code'; challenge: string } | { kind: 'forgot' };

export function LoginPage() {
  const { user, login, verifyCode } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [step, setStep] = useState<Step>({ kind: 'password' });
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const from = (location.state as { from?: string } | null)?.from ?? '/';
  if (user) return <Navigate to={from} replace />;

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    void run(async () => {
      if (step.kind === 'password') {
        const challenge = await login(email, password);
        if (challenge) {
          setStep({ kind: 'code', challenge: challenge.challenge });
          setPassword('');
        } else navigate(from, { replace: true });
      } else if (step.kind === 'code') {
        try {
          await verifyCode(step.challenge, code.trim());
          navigate(from, { replace: true });
        } catch (err) {
          setCode('');
          // Expired or too many tries: back to the password.
          if (errorText(err).includes('password again')) setStep({ kind: 'password' });
          throw err;
        }
      } else {
        const { message } = await api<{ message: string }>('/admin/auth/password/forgot', { method: 'POST', body: { email } });
        setNotice(message);
      }
    });
  }

  return (
    <div className="login">
      <form className="login-card" onSubmit={handleSubmit}>
        <h1>Print Studio Admin</h1>
        {step.kind === 'password' && <p className="muted">Sign in to manage orders, products and prices.</p>}
        {step.kind === 'code' && <p className="muted">Enter the 6-digit code from your authenticator app.</p>}
        {step.kind === 'forgot' && <p className="muted">We will email you a link to choose a new password.</p>}

        {step.kind !== 'code' && (
          <label className="field">
            <span>Email</span>
            <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </label>
        )}
        {step.kind === 'password' && (
          <label className="field">
            <span>Password</span>
            <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </label>
        )}
        {step.kind === 'code' && (
          <label className="field">
            <span>Code</span>
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="\d{6}"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              autoFocus
              required
            />
          </label>
        )}

        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {notice && <p className="muted">{notice}</p>}
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? 'Please wait…' : step.kind === 'password' ? 'Sign in' : step.kind === 'code' ? 'Verify' : 'Email me a link'}
        </button>
        {step.kind === 'password' ? (
          <button type="button" className="link-btn" onClick={() => (setStep({ kind: 'forgot' }), setError(null))}>
            Forgot your password?
          </button>
        ) : (
          <button type="button" className="link-btn" onClick={() => (setStep({ kind: 'password' }), setError(null), setNotice(null))}>
            Back to sign in
          </button>
        )}
      </form>
    </div>
  );
}
