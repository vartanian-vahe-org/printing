/** Uploads a customer file straight to storage with a presigned URL from the API. */

export interface UploadedObject {
  key: string;
}

export class UploadError extends Error {}

type UploadKind = 'artwork' | 'logo' | 'reference';

async function uploadBlob(kind: UploadKind, blob: Blob, filename: string): Promise<UploadedObject> {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL;
  if (!apiUrl) throw new UploadError('Uploads are not configured');

  const presign = await fetch(`${apiUrl}/uploads/presign`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ kind, filename, contentType: blob.type, sizeBytes: blob.size }),
  });
  if (!presign.ok) {
    const body = (await presign.json().catch(() => null)) as { issues?: string[] } | null;
    throw new UploadError(body?.issues?.[0] ?? 'Could not start the upload');
  }
  const { key, uploadUrl, headers } = (await presign.json()) as {
    key: string;
    uploadUrl: string;
    headers: Record<string, string>;
  };

  const put = await fetch(uploadUrl, { method: 'PUT', headers, body: blob });
  if (!put.ok) throw new UploadError('The upload failed. Please try again.');
  return { key };
}

/** "Upload your design" file types by extension, with the content type given to storage. CMYK only, so no PNG. */
export const ARTWORK_TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  ai: 'application/illustrator',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  psd: 'image/vnd.adobe.photoshop',
};
export const ARTWORK_ACCEPT = Object.keys(ARTWORK_TYPES).map((ext) => `.${ext}`).join(',');
export const ARTWORK_MAX_BYTES = 200 * 1024 * 1024;

export function artworkType(fileName: string): string | null {
  return ARTWORK_TYPES[fileName.toLowerCase().split('.').pop() ?? ''] ?? null;
}

/** Uploads an artwork file as is; the server check (checkArtwork) turns it into the print PDF. */
export function uploadArtwork(file: File): Promise<UploadedObject> {
  const type = artworkType(file.name);
  if (!type) return Promise.reject(new UploadError('Upload a PDF, AI, TIFF, JPG or PSD file.'));
  // Browsers report empty or varying types for AI and PSD files; storage gets ours.
  return uploadBlob('artwork', new Blob([file], { type }), file.name);
}

export interface ArtworkCheckRequest {
  geometry: { widthIn: number; heightIn: number; bleedIn: number; safeIn: number };
  /** 'back' for a separate back file. */
  side: 'front' | 'back';
  /** 2 when page 2 of the front file is the back. */
  maxPages: 1 | 2;
}

export interface ArtworkCheck {
  issues: { code: string; level: 'error' | 'warning'; message: string; page?: number }[];
  pageCount: number;
  /** The print PDF made from the upload (what goes in the cart), and a short-lived link to it. */
  key: string | null;
  url: string | null;
}

const CHECK_POLL_MS = 1000;
const CHECK_TIMEOUT_MS = 5 * 60 * 1000;

/** Runs the server file check of an uploaded artwork file and waits for the result. */
export async function checkArtwork(key: string, request: ArtworkCheckRequest): Promise<ArtworkCheck> {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL;
  if (!apiUrl) throw new UploadError('Uploads are not configured');
  const start = await fetch(`${apiUrl}/uploads/checks`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ key, ...request }),
  });
  if (!start.ok) {
    const body = (await start.json().catch(() => null)) as { message?: string } | null;
    throw new UploadError(body?.message ?? 'Could not check the file');
  }
  const { id } = (await start.json()) as { id: string };
  for (const until = Date.now() + CHECK_TIMEOUT_MS; Date.now() < until; ) {
    await new Promise((resolve) => setTimeout(resolve, CHECK_POLL_MS));
    const res = await fetch(`${apiUrl}/uploads/checks/${id}`);
    if (!res.ok) throw new UploadError('Could not check the file. Please try again.');
    const view = (await res.json()) as { status: 'checking' | 'done' | 'failed' } & Partial<ArtworkCheck> & { outputKey?: string | null };
    if (view.status === 'failed') throw new UploadError('We could not check this file. Please try again, or export it again.');
    if (view.status === 'done') return { issues: view.issues ?? [], pageCount: view.pageCount ?? 0, key: view.outputKey ?? null, url: view.url ?? null };
  }
  throw new UploadError('Checking the file is taking too long. Please try again.');
}

/** Types accepted as logo or reference files for our designer. */
export const REFERENCE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml', 'application/pdf'];
export const REFERENCE_MAX_BYTES = 25 * 1024 * 1024;

/** Uploads a logo or reference file for "let us design it for you". */
export function uploadReference(file: File): Promise<UploadedObject> {
  if (!REFERENCE_TYPES.includes(file.type)) return Promise.reject(new UploadError('Use a PNG, JPG, WebP, SVG or PDF file.'));
  if (file.size > REFERENCE_MAX_BYTES) return Promise.reject(new UploadError('Files can be up to 25 MB.'));
  return uploadBlob('reference', file, file.name);
}

/** Uploads a logo held as a data: URL (as used for the live preview). */
export async function uploadLogo(dataUrl: string): Promise<UploadedObject> {
  const blob = await (await fetch(dataUrl)).blob();
  const extension = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/svg+xml': 'svg' }[blob.type] ?? 'png';
  return uploadBlob('logo', blob, `logo.${extension}`);
}
