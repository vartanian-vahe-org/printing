import { parseLayout, type Template } from '@printing/templates';
import { describe, expect, it } from 'vitest';
import seed from '../../../packages/templates/seed/business-cards-templates.json' with { type: 'json' };
import { logoFieldKey, prepareTemplateDesign, prepareUploadDesign, templateTextValues } from '../lib/cart-design.js';
import type { PdfFileState } from '../lib/use-pdf-artwork.js';

const templates: Template[] = seed.templates.map((t) => ({ ...t, layout: parseLayout(t.layout) }));
const classic = templates[0]!;

const file = (patch: Partial<PdfFileState> = {}): PdfFileState => ({
  id: 1,
  fileName: 'card.pdf',
  sizeBytes: 1000,
  status: 'ready',
  upload: 'done',
  key: 'artwork/2026/10/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.pdf',
  pdf: { pageCount: 2, pages: [], doc: {} as never },
  ...patch,
});
const ok = { front: [{ level: 'ok' as const, message: 'fine' }], back: [] };

describe('template design', () => {
  it('keeps only this template text fields, trimmed and non-empty, never image data', () => {
    const values = { name: ' Jamie ', title: '', logo: 'data:image/png;base64,AAA', fax: '123' };
    expect(templateTextValues(classic, values)).toEqual({ name: 'Jamie' });
  });

  it('knows the logo field', () => {
    expect(logoFieldKey(classic)).toBe('logo');
  });

  it('needs a template and references the uploaded logo', () => {
    expect(prepareTemplateDesign(null, {}, null, true)).toEqual({ ok: false, message: 'Choose a template first.' });
    expect(prepareTemplateDesign(classic, { name: 'Jamie' }, 'logos/2026/10/x.png', true)).toEqual({
      ok: true,
      design: { mode: 'template', templateCode: 'classic', values: { name: 'Jamie' }, logoKey: 'logos/2026/10/x.png', reviewed: true },
    });
  });

  it('needs the customer to approve the preview', () => {
    expect(prepareTemplateDesign(classic, { name: 'Jamie' }, null, false)).toMatchObject({ ok: false, message: expect.stringContaining('approve') });
  });
});

describe('upload design', () => {
  it('requires a front file that is checked and uploaded', () => {
    expect(prepareUploadDesign({}, ok)).toMatchObject({ ok: false, message: 'Upload your front PDF first.' });
    expect(prepareUploadDesign({ front: file({ status: 'reading' }) }, ok)).toMatchObject({ ok: false });
    expect(prepareUploadDesign({ front: file({ upload: 'uploading' }) }, ok)).toMatchObject({ message: 'Still uploading your file…' });
    expect(prepareUploadDesign({ front: file({ upload: 'failed', key: undefined }) }, ok)).toMatchObject({ ok: false });
  });

  it('blocks when a check failed', () => {
    const bad = { front: [{ level: 'error' as const, message: 'wrong size' }], back: [] };
    expect(prepareUploadDesign({ front: file() }, bad)).toMatchObject({ ok: false });
  });

  it('builds front and optional back references with page counts', () => {
    expect(prepareUploadDesign({ front: file() }, ok)).toEqual({
      ok: true,
      design: { mode: 'upload', front: { key: file().key, fileName: 'card.pdf', pageCount: 2 }, proof: 'send' },
    });
    expect(prepareUploadDesign({ front: file() }, ok, 'skip')).toMatchObject({ ok: true, design: { proof: 'skip' } });
    const withBack = prepareUploadDesign({ front: file(), back: file({ fileName: 'back.pdf' }) }, ok);
    expect(withBack.ok && withBack.design.mode === 'upload' && withBack.design.back?.fileName).toBe('back.pdf');
  });
});
