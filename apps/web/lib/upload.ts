/** Uploads a customer file straight to storage with a presigned URL from the API. */

export interface UploadedObject {
  key: string;
}

export class UploadError extends Error {}

export async function uploadArtwork(file: File): Promise<UploadedObject> {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL;
  if (!apiUrl) throw new UploadError('Uploads are not configured');

  const presign = await fetch(`${apiUrl}/uploads/presign`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ filename: file.name, contentType: 'application/pdf', sizeBytes: file.size }),
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

  const put = await fetch(uploadUrl, { method: 'PUT', headers, body: file });
  if (!put.ok) throw new UploadError('The upload failed. Please try again.');
  return { key };
}
