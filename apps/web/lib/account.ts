/** Browser client for customer accounts (sign-in cookie is httpOnly; every call sends credentials). */
import { CART_CHANGED_EVENT } from './cart';
import type { ShippingAddress } from './checkout';

export interface Customer {
  id: string;
  email: string;
  name: string;
  emailVerified: boolean;
  lastShippingAddress: ShippingAddress | null;
}

export interface AccountOrder {
  number: number;
  placedAt: string;
  status: string;
  paymentStatus: string;
  proofStatus: 'pending' | 'awaiting_design' | 'awaiting_customer' | 'needs_new_file' | 'approved';
  totalCents: number;
  deliverFrom: string | null;
  deliverTo: string | null;
  items: { productName: string; quantity: number }[];
  orderPath: string;
}

export class AccountError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly issues: string[] = [],
  ) {
    super(message);
  }
}

/** Fired after sign-in, sign-out and registration so the header can refresh. */
export const ACCOUNT_CHANGED_EVENT = 'account:changed';

async function call<T>(path: string, method = 'GET', json?: unknown): Promise<T> {
  const url = process.env.NEXT_PUBLIC_API_URL;
  if (!url) throw new AccountError('Accounts are not configured', 0);
  const res = await fetch(`${url}${path}`, {
    method,
    credentials: 'include',
    headers: json === undefined ? undefined : { 'content-type': 'application/json' },
    body: json === undefined ? undefined : JSON.stringify(json),
  });
  if (res.status === 204) return undefined as T;
  const body = (await res.json().catch(() => null)) as (T & { message?: unknown; issues?: string[] }) | null;
  if (!res.ok || !body) {
    throw new AccountError(typeof body?.message === 'string' ? body.message : 'Something went wrong. Please try again.', res.status, body?.issues ?? []);
  }
  return body;
}

const changed = () => {
  window.dispatchEvent(new Event(ACCOUNT_CHANGED_EVENT));
  // Signing in can bring back a saved cart.
  window.dispatchEvent(new CustomEvent(CART_CHANGED_EVENT));
};

export const getMe = () => call<{ customer: Customer | null }>('/account/me').then((r) => r.customer);

export async function register(input: { email: string; name: string; password: string }) {
  const { customer } = await call<{ customer: Customer }>('/account/register', 'POST', input);
  changed();
  return customer;
}

export async function signIn(email: string, password: string) {
  const { customer } = await call<{ customer: Customer }>('/account/sign-in', 'POST', { email, password });
  changed();
  return customer;
}

export async function signOut() {
  await call<void>('/account/sign-out', 'POST');
  changed();
}

export const verifyEmail = (token: string) => call<void>('/account/verify', 'POST', { token });
export const resendVerification = () => call<{ message: string }>('/account/verify/resend', 'POST');
export const forgotPassword = (email: string) => call<{ message: string }>('/account/password/forgot', 'POST', { email });
export const resetPassword = (token: string, password: string) => call<void>('/account/password/reset', 'POST', { token, password });
export async function updateName(name: string) {
  const { customer } = await call<{ customer: Customer }>('/account/profile', 'PATCH', { name });
  window.dispatchEvent(new Event(ACCOUNT_CHANGED_EVENT));
  return customer;
}

export const changePassword = (currentPassword: string, newPassword: string) => call<void>('/account/password', 'POST', { currentPassword, newPassword });

export const getOrders = () => call<{ orders: AccountOrder[] }>('/account/orders').then((r) => r.orders);

export async function reorder(number: number) {
  const result = await call<{ added: number; skipped: string[] }>(`/account/orders/${number}/reorder`, 'POST');
  window.dispatchEvent(new CustomEvent(CART_CHANGED_EVENT));
  return result;
}
