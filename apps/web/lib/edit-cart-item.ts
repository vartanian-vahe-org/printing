/**
 * Loads a cart item back into the configurator ("Edit" in the cart): its options, its template text
 * and logo, or its uploaded PDFs (fetched again so the browser can check and preview them).
 */
import { getCart, type CartItem } from './cart';

export interface ItemToEdit {
  item: CartItem;
  /** The logo as a data: URL, like a freshly picked file. */
  logoDataUrl: string | null;
  files: { front?: File; back?: File };
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

async function download(url: string | undefined): Promise<Blob | null> {
  if (!url) return null;
  const res = await fetch(url);
  return res.ok ? res.blob() : null;
}

/** The `edit` query parameter of the current page, if any. */
export function editingItemId(): string | null {
  return new URLSearchParams(window.location.search).get('edit');
}

export async function loadItemToEdit(id: string): Promise<ItemToEdit | null> {
  const item = (await getCart()).items.find((i) => i.id === id);
  if (!item) return null;
  if (item.design.mode === 'template') {
    const logo = await download(item.previewUrls.logo);
    return { item, logoDataUrl: logo ? await blobToDataUrl(logo) : null, files: {} };
  }
  // The brief and its files are already stored; nothing to download.
  if (item.design.mode === 'service') return { item, logoDataUrl: null, files: {} };
  const { front, back } = item.design;
  const [frontBlob, backBlob] = await Promise.all([download(item.previewUrls.front), download(item.previewUrls.back)]);
  return {
    item,
    logoDataUrl: null,
    files: {
      ...(frontBlob ? { front: new File([frontBlob], front.fileName, { type: 'application/pdf' }) } : {}),
      ...(backBlob && back ? { back: new File([backBlob], back.fileName, { type: 'application/pdf' }) } : {}),
    },
  };
}
