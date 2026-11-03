import { parseLayout, type Template } from '@printing/templates';
import { describe, expect, it } from 'vitest';
import seed from '../../../packages/templates/seed/business-cards-templates.json' with { type: 'json' };
import { briefFromSaved, EMPTY_BRIEF, logoFieldKey, prepareServiceDesign, prepareTemplateDesign, prepareUploadDesign, templateTextValues } from '../lib/cart-design.js';
import type { PdfFileState } from '../lib/use-pdf-artwork.js';

const templates: Template[] = seed.templates.map((t) => ({ ...t, layout: parseLayout(t.layout) }));
const classic = templates[0]!;

const file = (patch: Partial<PdfFileState> = {}): PdfFileState => ({
  id: 1,
  fileName: 'card.pdf',
  sizeBytes: 1000,
  status: 'ready',
  issues: [],
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
  it('requires a front file that is uploaded and checked', () => {
    expect(prepareUploadDesign({}, ok)).toMatchObject({ ok: false, message: 'Upload your front file first.' });
    expect(prepareUploadDesign({ front: file({ status: 'uploading' }) }, ok)).toMatchObject({ message: 'Still uploading your file…' });
    expect(prepareUploadDesign({ front: file({ status: 'checking' }) }, ok)).toMatchObject({ message: 'Still checking your file…' });
    expect(prepareUploadDesign({ front: file({ status: 'error', key: undefined }) }, ok)).toMatchObject({ ok: false });
    expect(prepareUploadDesign({ front: file(), back: file({ status: 'checking' }) }, ok)).toMatchObject({ message: 'Still checking your file…' });
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

describe('design service brief', () => {
  it('needs at least one line to print', () => {
    expect(prepareServiceDesign('standard', { ...EMPTY_BRIEF, fields: { name: '  ' } })).toMatchObject({ ok: false });
  });

  it('sends the filled fields in form order, and the same text as lines', () => {
    const brief = { ...EMPTY_BRIEF, fields: { email: ' jane@acme.com ', name: 'Jane Doe', title: '' }, notes: ' Navy ' };
    expect(prepareServiceDesign('standard', brief)).toEqual({
      ok: true,
      design: {
        mode: 'service',
        tierCode: 'standard',
        brief: {
          content: 'Full name: Jane Doe\nEmail: jane@acme.com',
          fields: [
            { key: 'name', label: 'Full name', value: 'Jane Doe' },
            { key: 'email', label: 'Email', value: 'jane@acme.com' },
          ],
          notes: 'Navy',
          files: [],
        },
      },
    });
  });

  it('keeps a brief saved before the form had fields', () => {
    expect(briefFromSaved({ content: 'Jane Doe\nCEO', notes: '', files: [] }).fields).toEqual({ other: 'Jane Doe\nCEO' });
  });
});

