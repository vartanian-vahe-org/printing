/** Reads a customer logo for the preview: validates it and downsizes large images to keep the SVG light. */

export const LOGO_TYPES = ['image/png', 'image/jpeg', 'image/svg+xml', 'image/webp'];
export const LOGO_MAX_BYTES = 5 * 1024 * 1024;
const MAX_EDGE_PX = 1200;

export class LogoFileError extends Error {}

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new LogoFileError('Could not read the file'));
    reader.readAsDataURL(file);
  });
}

export async function readLogo(file: File): Promise<string> {
  if (!LOGO_TYPES.includes(file.type)) throw new LogoFileError('Please choose a PNG, JPG, WebP or SVG image');
  if (file.size > LOGO_MAX_BYTES) throw new LogoFileError('The logo must be 5 MB or smaller');

  const dataUrl = await readAsDataUrl(file);
  if (file.type === 'image/svg+xml') return dataUrl;

  const image = new Image();
  image.src = dataUrl;
  try {
    await image.decode();
  } catch {
    throw new LogoFileError('This image could not be opened');
  }
  const scale = Math.min(1, MAX_EDGE_PX / Math.max(image.naturalWidth, image.naturalHeight));
  if (scale === 1) return dataUrl;

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(image.naturalWidth * scale);
  canvas.height = Math.round(image.naturalHeight * scale);
  canvas.getContext('2d')!.drawImage(image, 0, 0, canvas.width, canvas.height);
  // PNG keeps transparency, which most logos need.
  return canvas.toDataURL('image/png');
}
