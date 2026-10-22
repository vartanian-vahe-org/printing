/** Uploads a PDF straight to file storage with a presigned link from the API (designer deliveries). */
import { api, ApiError } from './api';

export async function uploadPdf(file: File): Promise<{ key: string; fileName: string }> {
  const contentType = 'application/pdf';
  const presign = await api<{ key: string; uploadUrl: string; headers: Record<string, string> }>('/uploads/presign', {
    method: 'POST',
    body: { kind: 'artwork', filename: file.name, contentType, sizeBytes: file.size },
  });
  const put = await fetch(presign.uploadUrl, { method: 'PUT', headers: presign.headers, body: file });
  if (!put.ok) throw new ApiError(put.status, `Upload of ${file.name} failed (${put.status})`);
  return { key: presign.key, fileName: file.name };
}
