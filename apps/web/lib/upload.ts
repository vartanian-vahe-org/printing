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

export function uploadArtwork(file: File): Promise<UploadedObject> {
  // Some browsers report an empty type for PDFs picked from certain folders.
  const pdf = file.type === 'application/pdf' ? file : new Blob([file], { type: 'application/pdf' });
  return uploadBlob('artwork', pdf, file.name);
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
