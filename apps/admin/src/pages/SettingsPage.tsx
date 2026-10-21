import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, errorText } from '../api';
import { Toast } from '../components/Toast';
import { shopDate } from '../orders';

interface Settings {
  store: { storeName: string; supportEmail: string; orderNotificationEmails: string[] };
  calendar: { timezone: string; cutoffTime: string; workingDays: number[] };
  holidays: { date: string; name: string }[];
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** Store identity, production calendar and holidays (owners and admins). */
export function SettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [status, setStatus] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setSettings(await api<Settings>('/admin/settings'));
    } catch (err) {
      setStatus({ kind: 'error', text: errorText(err) });
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function save(action: () => Promise<unknown>, text: string) {
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

  if (!settings) return <p className="page-loading">Loading…</p>;
  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>Settings</h1>
          <p className="muted">Shown in emails and used for ship dates. Every change is recorded in Activity.</p>
        </div>
      </header>
      <StoreForm key={JSON.stringify(settings.store)} store={settings.store} busy={busy} onSave={(store) => save(() => api('/admin/settings/store', { method: 'PUT', body: store }), 'Store settings saved')} />
      <CalendarForm
        key={JSON.stringify(settings.calendar)}
        calendar={settings.calendar}
        busy={busy}
        onSave={(calendar) => save(() => api('/admin/settings/calendar', { method: 'PUT', body: calendar }), 'Production calendar saved')}
      />
      <Holidays
        holidays={settings.holidays}
        busy={busy}
        onAdd={(h) => save(() => api('/admin/settings/holidays', { method: 'POST', body: h }), 'Holiday added')}
        onRemove={(date) => save(() => api(`/admin/settings/holidays/${date}`, { method: 'DELETE' }), 'Holiday removed')}
      />
      <Toast status={status} onClose={() => setStatus(null)} />
    </div>
  );
}

function StoreForm({ store, busy, onSave }: { store: Settings['store']; busy: boolean; onSave: (s: Settings['store']) => Promise<boolean> }) {
  const [name, setName] = useState(store.storeName);
  const [support, setSupport] = useState(store.supportEmail);
  const [notify, setNotify] = useState(store.orderNotificationEmails.join(', '));
  function submit(e: FormEvent) {
    e.preventDefault();
    const emails = notify.split(/[,\s]+/).map((v) => v.trim()).filter(Boolean);
    void onSave({ storeName: name.trim(), supportEmail: support.trim(), orderNotificationEmails: emails });
  }
  return (
    <form className="card card-pad settings-card" onSubmit={submit}>
      <h2>Store</h2>
      <div className="form-grid">
        <label className="field">
          <span>Store name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
        </label>
        <label className="field">
          <span>Support email (reply-to on customer emails)</span>
          <input type="email" value={support} onChange={(e) => setSupport(e.target.value)} />
        </label>
      </div>
      <label className="field">
        <span>New order notifications go to (comma separated)</span>
        <input value={notify} onChange={(e) => setNotify(e.target.value)} />
      </label>
      <div className="form-actions">
        <button type="submit" className="btn btn-primary" disabled={busy}>
          Save store
        </button>
      </div>
    </form>
  );
}

function CalendarForm({ calendar, busy, onSave }: { calendar: Settings['calendar']; busy: boolean; onSave: (c: { cutoffTime: string; workingDays: number[] }) => Promise<boolean> }) {
  const [cutoff, setCutoff] = useState(calendar.cutoffTime);
  const [days, setDays] = useState(new Set(calendar.workingDays));
  const toggle = (day: number) =>
    setDays((current) => {
      const next = new Set(current);
      if (next.has(day)) next.delete(day);
      else next.add(day);
      return next;
    });
  return (
    <form
      className="card card-pad settings-card"
      onSubmit={(e) => {
        e.preventDefault();
        void onSave({ cutoffTime: cutoff, workingDays: [...days].sort() });
      }}
    >
      <h2>Production calendar</h2>
      <p className="muted">Orders paid and approved before the cutoff start production that day ({calendar.timezone}).</p>
      <div className="form-grid">
        <label className="field">
          <span>Daily cutoff</span>
          <input type="time" value={cutoff} onChange={(e) => setCutoff(e.target.value)} />
        </label>
        <div className="field">
          <span>Working days</span>
          <div className="weekday-row">
            {WEEKDAYS.map((label, i) => (
              <label key={label} className="check-line">
                <input type="checkbox" checked={days.has(i + 1)} onChange={() => toggle(i + 1)} /> {label}
              </label>
            ))}
          </div>
        </div>
      </div>
      <div className="form-actions">
        <button type="submit" className="btn btn-primary" disabled={busy || days.size === 0}>
          Save calendar
        </button>
      </div>
    </form>
  );
}

function Holidays({
  holidays,
  busy,
  onAdd,
  onRemove,
}: {
  holidays: Settings['holidays'];
  busy: boolean;
  onAdd: (h: { date: string; name: string }) => Promise<boolean>;
  onRemove: (date: string) => Promise<boolean>;
}) {
  const [date, setDate] = useState('');
  const [name, setName] = useState('');
  const today = new Date().toISOString().slice(0, 10);
  return (
    <section className="card card-pad settings-card">
      <h2>Holidays</h2>
      <p className="muted">No production and no deliveries on these days. Ship dates skip them.</p>
      <form
        className="note-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (date && name.trim()) void onAdd({ date, name: name.trim() }).then((ok) => ok && (setDate(''), setName('')));
        }}
      >
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Holiday date" />
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name, e.g. Thanksgiving Day" maxLength={80} aria-label="Holiday name" />
        <button type="submit" className="btn btn-small" disabled={busy || !date || !name.trim()}>
          Add
        </button>
      </form>
      <table className="mini-table">
        <tbody>
          {holidays.map((h) => (
            <tr key={h.date} className={h.date < today ? 'row-past' : undefined}>
              <td>{shopDate(h.date)}, {h.date.slice(0, 4)}</td>
              <td>{h.name}</td>
              <td className="num">
                <button type="button" className="link-btn" disabled={busy} onClick={() => void onRemove(h.date)}>
                  Remove
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
