import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, errorText, type AdminCatalog, type AdminProduct } from './api';

interface CatalogState {
  /** Every product the admin can configure (Business Cards, Postcards…). */
  products: AdminProduct[];
  /** The product the configuration pages show, picked in the sidebar. */
  product: AdminProduct | null;
  selectProduct: (code: string) => void;
  /** API path of the picked product, e.g. /admin/products/business-cards. */
  path: string;
  catalog: AdminCatalog | null;
  error: string | null;
  reload: () => Promise<void>;
}

const CatalogContext = createContext<CatalogState | null>(null);
const STORAGE_KEY = 'admin.product';

function rememberedProduct(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

/**
 * Loads the product list and the picked product's configuration once for all admin pages; pages call
 * reload() after saving. The picked product is remembered in this browser only.
 */
export function CatalogProvider({ children }: { children: ReactNode }) {
  const [products, setProducts] = useState<AdminProduct[]>([]);
  const [productCode, setProductCode] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<AdminCatalog | null>(null);
  const [error, setError] = useState<string | null>(null);
  const path = productCode ? `/admin/products/${productCode}` : '';

  useEffect(() => {
    api<{ products: AdminProduct[] }>('/admin/products')
      .then(({ products: list }) => {
        setProducts(list);
        const remembered = rememberedProduct();
        setProductCode(list.find((p) => p.code === remembered)?.code ?? list[0]?.code ?? null);
        if (list.length === 0) setError('No products yet.');
      })
      .catch((err: unknown) => setError(errorText(err)));
  }, []);

  const reload = useCallback(async () => {
    if (!path) return;
    try {
      setCatalog(await api<AdminCatalog>(`${path}/catalog`));
      setError(null);
    } catch (err) {
      setError(errorText(err));
    }
  }, [path]);

  useEffect(() => {
    setCatalog(null);
    void reload();
  }, [reload]);

  const selectProduct = useCallback((code: string) => {
    setProductCode(code);
    try {
      localStorage.setItem(STORAGE_KEY, code);
    } catch {
      // Private window: the pick just is not remembered.
    }
  }, []);

  const product = products.find((p) => p.code === productCode) ?? null;
  return (
    <CatalogContext.Provider value={{ products, product, selectProduct, path, catalog, error, reload }}>{children}</CatalogContext.Provider>
  );
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
