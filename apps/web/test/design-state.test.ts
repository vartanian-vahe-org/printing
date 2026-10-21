import { resolveSize } from '@printing/pricing';
import { parseLayout, type Template } from '@printing/templates';
import { describe, expect, it } from 'vitest';
import { businessCards } from '../../../packages/pricing/test/fixtures/business-cards.js';
import seed from '../../../packages/templates/seed/business-cards-templates.json' with { type: 'json' };
import { ensureTemplateForSize, initialDesign, layoutArtwork, templatesForSize, visibleFields } from '../lib/design-state.js';

const templates: Template[] = seed.templates.map((t) => ({ ...t, layout: parseLayout(t.layout) }));
const std = resolveSize(businessCards, 'std_3_5x2');

describe('design state', () => {
  it('starts with the first template that supports the size', () => {
    expect(initialDesign(templates, 'std_3_5x2').templateCode).toBe('classic');
  });

  it('filters templates by size', () => {
    expect(templatesForSize(templates, 'square_2_5').map((t) => t.code)).toEqual(['classic', 'centered', 'midnight']);
  });

  it('switches to a supported template when the size changes, keeping typed values', () => {
    const design = { templateCode: 'minimal', values: { name: 'Jamie' } };
    const { design: next, replaced } = ensureTemplateForSize(templates, design, 'square_2_5');
    expect(next).toEqual({ templateCode: 'classic', values: { name: 'Jamie' } });
    expect(replaced?.code).toBe('minimal');
    expect(ensureTemplateForSize(templates, next, 'square_2_5').replaced).toBeNull();
  });

  it('renders both sides, or only the front when the back is blank', () => {
    const classic = templates[0]!;
    const both = layoutArtwork(classic, { name: 'Jamie Lee' }, std, 'separate');
    const texts = (scene: { items: { kind: string; text?: string }[] } | null) => scene?.items.flatMap((i) => (i.kind === 'text' ? [i.text] : [])) ?? [];
    expect(texts(both.front)).toContain('Jamie Lee');
    expect(texts(both.back)).toContain('Morgan Studio');
    expect(layoutArtwork(classic, {}, std, 'blank').back).toBeNull();
  });

  it('reports text that is too long once per field', () => {
    const art = layoutArtwork(templates[0]!, { company: 'W'.repeat(80) }, std, 'separate');
    expect(art.warnings).toEqual([{ field: 'company', issue: 'text-too-long' }]);
  });

  it('hides back-only fields when the back is blank', () => {
    const keys = visibleFields(templates[0]!, 'blank').map((f) => f.key);
    expect(keys).not.toContain('tagline');
    expect(keys).toContain('name');
  });
});
