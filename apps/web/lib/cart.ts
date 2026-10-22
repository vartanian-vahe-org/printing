/** Browser client for the cart API (cookie-based guest cart). */

export interface CartItem {
  id: string;
  productCode: string;
  productName: string;
  configuration: {
    selection: Record<string, string>;
    quantity: number;
    customSize?: { widthIn: number; heightIn: number };
  };
  design:
    | { mode: 'template'; templateCode: string; values: Record<string, string>; logoKey?: string; reviewed?: true }
    | {
        mode: 'upload';
        front: { key: string; fileName: string; pageCount: number };
        back?: { key: string; fileName: string; pageCount: number };
        /** 'send': proof to approve after ordering · 'skip': print right away. */
        proof?: UploadProof;
      }
    | { mode: 'service'; tierCode: string; brief: ServiceBrief };
  summary: { label: string; value: string }[];
  quantity: number;
  totalCents: number | null;
  unitPriceCents: number | null;
  addedTotalCents: number;
  priceChanged: boolean;
  issues: string[];
  shipDate: string | null;
  /** Short-lived links to the customer's logo or PDFs (previews, editing). */
  previewUrls: { logo?: string; front?: string; back?: string };
  /** "Let us design it" package and its fee (included in totalCents), or null. */
  designService: { code: string; name: string; priceCents: number } | null;
}

export type UploadProof = 'send' | 'skip';

/** What the customer tells our designer ("let us design it for you"). */
export interface ServiceBrief {
  /** Text to print on the card. */
  content: string;
  /** Look and feel. */
  notes: string;
  /** Logo and reference files, already uploaded. */
  files: { key: string; fileName: string }[];
}

export interface Cart {
  items: CartItem[];
  itemCount: number;
  subtotalCents: number;
  hasUnavailableItems: boolean;
  /** Ship day of the whole order if placed now, the cutoff for it, and the shop time zone. */
  shipDate: string | null;
  orderBy: string | null;
  timezone: string | null;
}

export type AddToCartInput = {
  productCode: string;
  configuration: CartItem['configuration'];
  design: CartItem['design'];
};

export class CartError extends Error {
  constructor(
    message: string,
    public readonly issues: string[] = [],
  ) {
    super(message);
  }
}

/** Fired on window after every cart change so the header badge can refresh. */
export const CART_CHANGED_EVENT = 'cart:changed';

function apiUrl(): string {
  const url = process.env.NEXT_PUBLIC_API_URL;
  if (!url) throw new CartError('The cart is not configured');
  return url;
}

async function request(path: string, init: RequestInit = {}): Promise<Cart> {
  const res = await fetch(`${apiUrl()}${path}`, {
    ...init,
    credentials: 'include',
    headers: init.body ? { 'content-type': 'application/json' } : undefined,
  });
  const body = (await res.json().catch(() => null)) as (Cart & { message?: string; issues?: string[] }) | null;
  if (!res.ok || !body) {
    throw new CartError(typeof body?.message === 'string' ? body.message : 'Something went wrong. Please try again.', body?.issues ?? []);
  }
  if (init.method && init.method !== 'GET') {
    window.dispatchEvent(new CustomEvent(CART_CHANGED_EVENT, { detail: body.itemCount }));
  }
  return body;
}

export const getCart = () => request('/cart');

export const addToCart = (input: AddToCartInput) =>
  request('/cart/items', { method: 'POST', body: JSON.stringify(input) });

export const updateCartItem = (id: string, quantity: number) =>
  request(`/cart/items/${id}`, { method: 'PATCH', body: JSON.stringify({ quantity }) });

/** Replaces an item after the customer edited it in the configurator. */
export const replaceCartItem = (id: string, input: AddToCartInput) =>
  request(`/cart/items/${id}`, { method: 'PUT', body: JSON.stringify(input) });

export const removeCartItem = (id: string) => request(`/cart/items/${id}`, { method: 'DELETE' });
