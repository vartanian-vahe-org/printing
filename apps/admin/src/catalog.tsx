import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, errorText, productPath, type AdminCatalog } from './api';

interface CatalogState {
  catalog: AdminCatalog | null;
  error: string | null;
  reload: () => Promise<void>;
}

const CatalogContext = createContext<CatalogState | null>(null);

/** Loads the product configuration once for all admin pages; pages call reload() after saving. */
export function CatalogProvider({ children }: { children: ReactNode }) {
  const [catalog, setCatalog] = useState<AdminCatalog | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setCatalog(await api<AdminCatalog>(`${productPath}/catalog`));
      setError(null);
    } catch (err) {
      setError(errorText(err));
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return <CatalogContext.Provider value={{ catalog, error, reload }}>{children}</CatalogContext.Provider>;
}

export function useCatalog(): CatalogState {
  const value = useContext(CatalogContext);
  if (!value) throw new Error('useCatalog must be used inside CatalogProvider');
  return value;
}

/** Runs a save, shows the result as a toast, and reloads the catalog on success. */
export function useSaver() {
  const { reload } = useCatalog();
  const [status, setStatus] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const save = useCallback(
    async (action: () => Promise<unknown>, successText = 'Saved') => {
      setSaving(true);
      try {
        await action();
        await reload();
        setStatus({ kind: 'ok', text: successText });
        return true;
      } catch (err) {
        setStatus({ kind: 'error', text: errorText(err) });
        return false;
      } finally {
        setSaving(false);
      }
    },
    [reload],
  );

  return { save, saving, status, clearStatus: () => setStatus(null) };
}

export function dollars(cents: number): string {
  return (cents / 100).toFixed(2);
}

/** Parses "12.5" / "-3" into cents; null when not a valid amount. */
export function parseDollars(text: string): number | null {
  if (!/^-?\d+(\.\d{0,2})?$/.test(text.trim())) return null;
  return Math.round(Number(text) * 100);
}
