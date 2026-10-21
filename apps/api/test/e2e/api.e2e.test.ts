/**
 * HTTP tests against a running API (default http://localhost:4000, e.g. `docker compose up`).
 * Run from the host so presigned upload URLs (http://localhost:9000) are reachable.
 */
import { describe, expect, it } from 'vitest';

const base = process.env.API_BASE_URL ?? 'http://localhost:4000';

const defaultSelection = {
  size: 'std_3_5x2',
  paper: '14pt',
  coating: 'matte_both',
  printed_side: 'front_back',
  corners: 'square',
  turnaround: '3d',
};

async function post(path: string, body: unknown) {
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as Record<string, any> };
}

describe('GET /health', () => {
  it('reports database, redis and storage up', async () => {
    const res = await fetch(`${base}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: 'ok' });
  });
});

describe('GET /products/:code/configurator', () => {
  it('returns the catalog and resolved defaults', async () => {
    const res = await fetch(`${base}/products/business-cards/configurator`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.catalog.groups.map((g: any) => g.code)).toEqual([
      'size',
      'paper',
      'coating',
      'printed_side',
      'corners',
      'turnaround',
    ]);
    expect(body.catalog.rules).toHaveLength(7);
    expect(body.defaults).toEqual({ selection: defaultSelection, quantity: 500 });
  });

  it('404 for an unknown product', async () => {
    expect((await fetch(`${base}/products/flyers/configurator`)).status).toBe(404);
  });
});

describe('GET /products/:code/templates', () => {
  it('returns the five seeded templates with validated layouts', async () => {
    const res = await fetch(`${base}/products/business-cards/templates`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.templates.map((t: any) => t.code)).toEqual(['classic', 'centered', 'color-band', 'minimal', 'midnight']);
    // Defaults from the layout schema are filled in by the API.
    expect(body.templates[0].layout.front.elements[0].box).toBe('safe');
  });
});

describe('POST /quotes', () => {
  it('prices the default configuration', async () => {
    const res = await post('/quotes', { productCode: 'business-cards', selection: defaultSelection, quantity: 500 });
    expect(res.status).toBe(200);
    expect(res.body.totalCents).toBe(3948);
  });

  it('prices a custom size with the formula', async () => {
    const res = await post('/quotes', {
      productCode: 'business-cards',
      selection: { ...defaultSelection, size: 'custom' },
      quantity: 500,
      customSize: { widthIn: 3, heightIn: 3 },
    });
    expect(res.status).toBe(200);
    expect(res.body.totalCents).toBe(10056);
    expect(res.body.size.priceMultiplier).toBe(2.547);
  });

  it('400 with issues for a configuration hidden by rules', async () => {
    const res = await post('/quotes', {
      productCode: 'business-cards',
      selection: { ...defaultSelection, paper: '17pt_uncoated', turnaround: '1d' },
      quantity: 500,
    });
    expect(res.status).toBe(400);
    expect(res.body.issues).toEqual([
      '"matte_both" is not available for "coating" with the other options selected',
      '"1d" is not available for "turnaround" with the other options selected',
    ]);
  });

  it('400 for a malformed body', async () => {
    const res = await post('/quotes', { productCode: 'business-cards', quantity: -1 });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Invalid request body');
  });
});

describe('POST /uploads/presign', () => {
  const pdf = new TextEncoder().encode('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');

  it('returns a URL that accepts exactly the declared PDF', async () => {
    const res = await post('/uploads/presign', {
      filename: 'front.pdf',
      contentType: 'application/pdf',
      sizeBytes: pdf.byteLength,
    });
    expect(res.status).toBe(201);
    expect(res.body.key).toMatch(/^artwork\/\d{4}\/\d{2}\/[0-9a-f-]{36}\.pdf$/);

    const upload = await fetch(res.body.uploadUrl, { method: 'PUT', headers: res.body.headers, body: pdf });
    expect(upload.status).toBe(200);

    const tampered = await fetch(res.body.uploadUrl, {
      method: 'PUT',
      headers: res.body.headers,
      body: new Uint8Array(pdf.byteLength + 10),
    });
    expect(tampered.status).toBe(403);
  });

  it('rejects non-PDF and oversized files', async () => {
    expect((await post('/uploads/presign', { filename: 'a.png', contentType: 'image/png', sizeBytes: 10 })).status).toBe(400);
    expect(
      (await post('/uploads/presign', { filename: 'a.pdf', contentType: 'application/pdf', sizeBytes: 999_999_999 })).status,
    ).toBe(400);
  });
});
