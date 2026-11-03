import type { StorageService } from '../storage/storage.service.js';

export interface CardGeometry {
  widthIn: number;
  heightIn: number;
  bleedIn: number;
}

/** The card a file was checked for, written by the prepress worker as '3.5x2+0.125'. */
export function geometryTag(geometry: CardGeometry): string {
  return `${geometry.widthIn}x${geometry.heightIn}+${geometry.bleedIn}`;
}

/**
 * Why an artwork file cannot be printed on this card, or null when it passed the upload check
 * (POST /uploads/checks) for exactly this card size. The worker marks the print PDF it makes from
 * an upload as passed or failed; files never checked (the customer's original JPG, TIFF…) are refused.
 */
export async function artworkProblem(storage: StorageService, key: string, geometry: CardGeometry, label: string): Promise<string | null> {
  const object = await storage.describe(key);
  if (!object) return `${label} was not found. Please upload it again.`;
  if (object.metadata.check !== 'passed') return `${label} did not pass the file check. Upload a corrected file.`;
  if (object.metadata.geometry !== geometryTag(geometry)) return `${label} was checked for another card size. Upload it again for this size.`;
  return null;
}
