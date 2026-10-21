/** Admin API client. The session lives in an httpOnly cookie, so every request sends credentials. */

const apiUrl = import.meta.env.VITE_API_URL ?? '';

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
}

export interface AdminValue {
  code: string;
  label: string;
  description: string | null;
  sortOrder: number;
  isActive: boolean;
  isDefault: boolean;
  attributes: Record<string, unknown>;
}

export interface AdminGroup {
  code: string;
  label: string;
  sortOrder: number;
  values: AdminValue[];
}

export interface AdminRule {
  whenGroup: string;
  whenValue: string;
  targetGroup: string;
  allowed: string[];
}

export interface AdminTier {
  quantity: number;
  basePriceCents: number;
  sortOrder: number;
  isActive: boolean;
  isDefault: boolean;
}

export interface AdminUpcharge {
  group: string;
  value: string;
  quantity: number;
  upchargeCents: number;
}

export interface AdminTemplate {
  code: string;
  name: string;
  description: string | null;
  sortOrder: number;
  isActive: boolean;
  supportedSizeCodes: string[];
}

export interface AdminCatalog {
  product: { code: string };
  groups: AdminGroup[];
  rules: AdminRule[];
  quantityTiers: AdminTier[];
  upcharges: AdminUpcharge[];
  templates: AdminTemplate[];
}

export const PRODUCT = 'business-cards';
export const productPath = `/admin/products/${PRODUCT}`;
