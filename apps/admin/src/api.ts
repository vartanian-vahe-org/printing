/** Admin API client. The session lives in an httpOnly cookie, so every request sends credentials. */

const apiUrl = import.meta.env.VITE_API_URL ?? '';

/** Absolute API URL, for links the browser opens itself (file downloads use the session cookie). */
export function apiHref(path: string): string {
  return `${apiUrl}${path}`;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly issues: string[] = [],
  ) {
    super(message);
  }
}

export async function api<T = void>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`${apiUrl}${path}`, {
    method: options.method ?? 'GET',
    credentials: 'include',
    headers: options.body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!res.ok) {
    const message = typeof data?.message === 'string' ? data.message : `Request failed (${res.status})`;
    const issues = Array.isArray(data?.issues) ? (data.issues as string[]) : [];
    throw new ApiError(res.status, message, issues);
  }
  return data as T;
}

export function errorText(err: unknown): string {
  if (err instanceof ApiError) return err.issues.length ? `${err.message}: ${err.issues.join('; ')}` : err.message;
  return err instanceof Error ? err.message : String(err);
}

// ---------------------------------------------------------------- types

export interface StaffUser {
  email: string;
  name: string;
  role: 'owner' | 'admin' | 'staff';
  twoFactorEnabled: boolean;
}

export interface AdminValue {
  code: string;
  label: string;
  description: string | null;
  sortOrder: number;
  isActive: boolean;
  isDefault: boolean;
  attributes: Record<string, unknown>;
  /** Add-ons: percent of the core price. */
  addonPercent: number;
}

export interface AdminGroup {
  code: string;
  label: string;
  sortOrder: number;
  values: AdminValue[];
}

/** An option of the shared library, and the products using it. */
export interface LibraryValue {
  code: string;
  label: string;
  description: string | null;
  sortOrder: number;
  attributes: Record<string, unknown>;
  usedBy: string[];
}

export interface LibraryQuantity {
  quantity: number;
  usedBy: string[];
}

export interface LibraryGroup {
  code: string;
  label: string;
  sortOrder: number;
  /** Every product needs it: it can be renamed, not deleted. */
  required: boolean;
  values: LibraryValue[];
}

export interface AdminRule {
  whenGroup: string;
  whenValue: string;
  targetGroup: string;
  allowed: string[];
}

export interface AdminTier {
  quantity: number;
  sortOrder: number;
  isActive: boolean;
  isDefault: boolean;
}

/** Set price of a size, paper and printed sides combination at a quantity. */
export interface AdminCorePrice {
  size: string;
  paper: string;
  printedSide: string;
  quantity: number;
  priceCents: number;
}

/** One offered cell of the quantity × speed turnaround table. */
export interface AdminTurnaround {
  value: string;
  quantity: number;
  businessDays: number;
  /** Added to the printing price, in percent; negative for a discount. */
  percent: number;
}

export interface AdminTemplate {
  code: string;
  name: string;
  description: string | null;
  sortOrder: number;
  isActive: boolean;
  supportedSizeCodes: string[];
  /** Filter values by filter code. */
  tags: Record<string, string[]>;
}

/** A template filter shown on the storefront (Industry, Style…). */
export interface AdminFacet {
  code: string;
  name: string;
  values: { code: string; name: string }[];
}

/** A "let us design it for you" package. */
export interface AdminDesignService {
  code: string;
  name: string;
  description: string | null;
  priceCents: number;
  features: string[];
  designDays: number;
  /** Rounds of changes included; null = unlimited. */
  revisions: number | null;
  sortOrder: number;
  isActive: boolean;
}

export interface AdminProduct {
  /** Also the storefront URL. */
  code: string;
  name: string;
  description: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  /** What customers call one and several of it, e.g. "flyer" and "flyers". */
  unitName: string;
  unitNamePlural: string;
  sortOrder: number;
  isActive: boolean;
  /** Why it cannot go on the storefront yet; null when it can. */
  setupIssue: string | null;
}

export interface AdminCatalog {
  product: { code: string; name: string };
  groups: AdminGroup[];
  rules: AdminRule[];
  quantityTiers: AdminTier[];
  corePrices: AdminCorePrice[];
  turnarounds: AdminTurnaround[];
  templates: AdminTemplate[];
  templateFacets: AdminFacet[];
  designServices: AdminDesignService[];
}
