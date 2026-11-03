/** What customers may upload, and where each kind is stored. */
export const UPLOAD_KINDS = {
  /**
   * "Upload your design": PDF, Illustrator, TIFF, JPG or Photoshop, CMYK only (checked by the worker,
   * which stores a print PDF next to it). The type is what the storefront says; the worker reads the bytes.
   */
  artwork: {
    prefix: 'artwork/',
    contentTypes: ['application/pdf', 'application/illustrator', 'image/tiff', 'image/jpeg', 'image/vnd.adobe.photoshop'],
    extension: {
      'application/pdf': 'pdf',
      'application/illustrator': 'ai',
      'image/tiff': 'tif',
      'image/jpeg': 'jpg',
      'image/vnd.adobe.photoshop': 'psd',
    },
  },
  /** Logo placed into a template. */
  logo: {
    prefix: 'logos/',
    contentTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'],
    extension: { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/svg+xml': 'svg' },
  },
  /** Logo, photos or examples for "let us design it for you". */
  reference: {
    prefix: 'references/',
    contentTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml', 'application/pdf'],
    extension: { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/svg+xml': 'svg', 'application/pdf': 'pdf' },
  },
} as const;

export type UploadKind = keyof typeof UPLOAD_KINDS;

/** True when the key was issued by POST /uploads/presign for this kind. */
export function isUploadKey(kind: UploadKind, key: string): boolean {
  return new RegExp(`^${UPLOAD_KINDS[kind].prefix}\\d{4}/\\d{2}/[0-9a-f-]{36}\\.[a-z]+$`).test(key);
}
