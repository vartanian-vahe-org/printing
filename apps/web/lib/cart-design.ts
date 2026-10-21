/**
 * Turns the on-page design (template values or uploaded PDFs) into the cart's design payload,
 * or explains what is still missing.
 */
import type { Template } from '@printing/templates';
import type { CartItem } from './cart';
import { worstLevel, type CheckResult } from './pdf-checks';
import type { PdfFileState } from './use-pdf-artwork';

export type PreparedDesign = { ok: true; design: CartItem['design'] } | { ok: false; message: string };

/** Text values for the template's own fields, without empty values or image data. */
export function templateTextValues(template: Template, values: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const field of template.layout.fields) {
    if (field.type !== 'text') continue;
    const value = values[field.key]?.trim();
    if (value) result[field.key] = value;
  }
  return result;
}

/** Key of the template's logo (image) field, if any. */
export function logoFieldKey(template: Template): string | null {
  return template.layout.fields.find((f) => f.type === 'image')?.key ?? null;
}

export function prepareTemplateDesign(
  template: Template | null,
  values: Record<string, string>,
  logoKey: string | null,
): PreparedDesign {
  if (!template) return { ok: false, message: 'Choose a template first.' };
  return {
    ok: true,
    design: {
      mode: 'template',
      templateCode: template.code,
      values: templateTextValues(template, values),
      ...(logoKey ? { logoKey } : {}),
    },
  };
}

export function prepareUploadDesign(
  files: Partial<Record<'front' | 'back', PdfFileState>>,
  checks: { front: CheckResult[]; back: CheckResult[] },
): PreparedDesign {
  const front = files.front;
  if (!front) return { ok: false, message: 'Upload your front PDF first.' };
  if (front.status === 'reading') return { ok: false, message: 'Still checking your file…' };
  if (front.status === 'error') return { ok: false, message: front.error ?? 'Your front PDF cannot be used.' };
  if (worstLevel([...checks.front, ...checks.back]) === 'error') {
    return { ok: false, message: 'Fix the problems with your file before adding it to the cart.' };
  }
  for (const file of [front, files.back]) {
    if (!file) continue;
    if (file.upload === 'uploading') return { ok: false, message: 'Still uploading your file…' };
    if (file.upload !== 'done' || !file.key) return { ok: false, message: `"${file.fileName}" was not uploaded. Replace it to try again.` };
  }

  const ref = (file: PdfFileState) => ({ key: file.key!, fileName: file.fileName, pageCount: file.pdf?.pageCount ?? 1 });
  const back = files.back?.status === 'ready' ? files.back : undefined;
  return { ok: true, design: { mode: 'upload', front: ref(front), ...(back ? { back: ref(back) } : {}) } };
}
