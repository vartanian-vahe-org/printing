import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { api, errorText, type AdminCatalog, type AdminProduct } from './api';

/** Where product pages live, from the "View storefront" setting. */
export const STOREFRONT_ORIGIN = new URL(import.meta.env.VITE_STOREFRONT_URL ?? 'http://localhost:3000').origin;

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
  /** After adding, editing or deleting a product. */
  reloadProducts: () => Promise<void>;
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
  const pathRef = useRef(path);
  pathRef.current = path;

  const reloadProducts = useCallback(async () => {
    const { products: list } = await api<{ products: AdminProduct[] }>('/admin/products');
    setProducts(list);
    setProductCode((current) => {
      const wanted = current ?? rememberedProduct();
      return list.find((p) => p.code === wanted)?.code ?? list[0]?.code ?? null;
    });
    if (list.length === 0) setError('No products yet.');
  }, []);

  useEffect(() => {
    reloadProducts().catch((err: unknown) => setError(errorText(err)));
  }, [reloadProducts]);

  // Reads the path at call time: a save may have just deleted the product that was picked.
  const reload = useCallback(async () => {
    const current = pathRef.current;
    if (!current) return;
    try {
      const data = await api<AdminCatalog>(`${current}/catalog`);
      if (current !== pathRef.current) return;
      setCatalog(data);
      setError(null);
    } catch (err) {
      if (current === pathRef.current) setError(errorText(err));
    }
  }, []);

  useEffect(() => {
    setCatalog(null);
    void reload();
  }, [path, reload]);

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
    <CatalogContext.Provider value={{ products, product, selectProduct, path, catalog, error, reload, reloadProducts }}>{children}</CatalogContext.Provider>
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
