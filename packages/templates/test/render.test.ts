import { describe, expect, it } from 'vitest';
import seed from '../seed/business-cards-templates.json' with { type: 'json' };
import { parseLayout, type TemplateLayout } from '../src/layout.js';
import { approximateMeasure, escapeXml, fieldsFor, renderFace, type CardGeometry } from '../src/render.js';

const SIZES: Record<string, CardGeometry> = {
  std_3_5x2: { widthIn: 3.5, heightIn: 2, bleedIn: 0.125, safeIn: 0.125 },
  square_2_5: { widthIn: 2.5, heightIn: 2.5, bleedIn: 0.125, safeIn: 0.125 },
  slim_3_5x1_75: { widthIn: 3.5, heightIn: 1.75, bleedIn: 0.125, safeIn: 0.125 },
  // Extreme custom sizes from the 2"-4" range.
  custom: { widthIn: 2, heightIn: 4, bleedIn: 0.125, safeIn: 0.125 },
};

const layouts = seed.templates.map((t) => ({ ...t, layout: parseLayout(t.layout) }));
const classic = layouts.find((t) => t.code === 'classic')!.layout;
const std = SIZES.std_3_5x2!;

describe('seeded templates', () => {
  it('all five parse against the layout schema', () => {
    expect(layouts.map((t) => t.code)).toEqual(['classic', 'centered', 'color-band', 'minimal', 'midnight']);
  });

  for (const template of layouts) {
    for (const sizeCode of template.supportedSizeCodes) {
      it(`${template.code} renders both sides at ${sizeCode} with sample text that fits`, () => {
        for (const side of ['front', 'back'] as const) {
          const result = renderFace({ layout: template.layout, side, values: {}, geometry: SIZES[sizeCode]! });
          expect(result.svg.startsWith('<svg')).toBe(true);
          expect(result.warnings).toEqual([]);
        }
      });
    }
  }
});

describe('renderFace', () => {
  it('uses the trim box as viewBox for previews and the bleed box for print', () => {
    expect(renderFace({ layout: classic, side: 'front', values: {}, geometry: std }).svg).toContain('viewBox="9 9 252 144"');
    const print = renderFace({ layout: classic, side: 'front', values: {}, geometry: std, area: 'bleed' });
    expect(print.svg).toContain('viewBox="0 0 270 162"');
    expect([print.widthPt, print.heightPt]).toEqual([270, 162]);
  });

  it('fills the whole bleed area with the background color', () => {
    const { svg } = renderFace({ layout: classic, side: 'back', values: {}, geometry: std });
    expect(svg).toContain('<rect x="0" y="0" width="270" height="162" fill="#1f3a5f"/>');
  });

  it('positions text relative to the safe box', () => {
    // safe box: x 18, y 18, w 234, h 126 -> name at y = 18 + 0.55 * 126 = 87.3
    const { svg } = renderFace({ layout: classic, side: 'front', values: { name: 'Jamie' }, geometry: std });
    expect(svg).toMatch(/<text x="18" y="87.3"[^>]*>Jamie<\/text>/);
  });

  it('shows sample text for empty fields in previews but not in print files', () => {
    expect(renderFace({ layout: classic, side: 'front', values: {}, geometry: std }).svg).toContain('Alex Morgan');
    const print = renderFace({ layout: classic, side: 'front', values: {}, geometry: std, useSamples: false });
    expect(print.svg).not.toContain('Alex Morgan');
    expect(print.svg).not.toContain('LOGO');
  });

  it('escapes customer text', () => {
    const { svg } = renderFace({ layout: classic, side: 'front', values: { name: '<script>&"' }, geometry: std });
    expect(svg).toContain('&lt;script&gt;&amp;&quot;');
    expect(svg).not.toContain('<script>');
  });

  it('applies uppercase and letter spacing', () => {
    const { svg } = renderFace({ layout: classic, side: 'front', values: { company: 'Acme' }, geometry: std });
    expect(svg).toMatch(/letter-spacing="0.56"[^>]*>ACME<\/text>/);
  });

  it('shrinks long text to fit, and warns when it cannot', () => {
    const long = 'Alexandria Montgomery-Fitzgerald the Third';
    const fitted = renderFace({ layout: classic, side: 'front', values: { name: long }, geometry: std });
    const size = Number(/font-size="([\d.]+)"[^>]*>Alexandria/.exec(fitted.svg)![1]);
    expect(size).toBeLessThan(13);
    expect(approximateMeasure(long, { family: 'sans', weight: 700, size })).toBeLessThanOrEqual(234 + 0.01);
    expect(fitted.warnings).toEqual([]);

    const huge = renderFace({ layout: classic, side: 'front', values: { name: 'W'.repeat(80) }, geometry: std });
    expect(huge.warnings).toEqual([{ field: 'name', issue: 'text-too-long' }]);
  });

  it('places an uploaded logo with preserveAspectRatio, or a LOGO placeholder', () => {
    const withLogo = renderFace({ layout: classic, side: 'front', values: { logo: 'data:image/png;base64,AAAA' }, geometry: std });
    expect(withLogo.svg).toContain('preserveAspectRatio="xMinYMid meet" href="data:image/png;base64,AAAA"');
    expect(renderFace({ layout: classic, side: 'front', values: {}, geometry: std }).svg).toContain('>LOGO</text>');
  });

  it('uses a custom measurer when given', () => {
    const calls: string[] = [];
    renderFace({
      layout: classic,
      side: 'front',
      values: {},
      geometry: std,
      measure: (text, font) => {
        calls.push(text);
        return text.length * font.size * 0.5;
      },
    });
    expect(calls).toContain('Alex Morgan');
  });
});

describe('fieldsFor', () => {
  it('hides back-only fields when the back is blank or repeats the front', () => {
    const keys = (layout: TemplateLayout, mode: Parameters<typeof fieldsFor>[1]) => fieldsFor(layout, mode).map((f) => f.key);
    expect(keys(classic, 'separate')).toContain('tagline');
    expect(keys(classic, 'blank')).not.toContain('tagline');
    expect(keys(classic, 'same_as_front')).toContain('company');
  });
});

describe('escapeXml', () => {
  it('escapes the five XML entities', () => {
    expect(escapeXml(`<a href="x">'&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&apos;&amp;&apos;&lt;/a&gt;');
  });
});

describe('layout schema', () => {
  it('rejects elements that reference unknown fields', () => {
    const broken = JSON.parse(JSON.stringify(seed.templates[0]!.layout)) as Record<string, any>;
    broken.front.elements.push({ type: 'text', field: 'fax', x: 0, y: 0, maxWidth: 1, size: 7, color: '#000000' });
    expect(() => parseLayout(broken)).toThrow(/Unknown field/);
  });

  it('rejects colors that are not #rrggbb', () => {
    const broken = JSON.parse(JSON.stringify(seed.templates[0]!.layout)) as Record<string, any>;
    broken.front.background = 'red';
    expect(() => parseLayout(broken)).toThrow();
  });
});
