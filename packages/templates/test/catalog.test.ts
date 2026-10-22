import { describe, expect, it } from 'vitest';
import { facetCounts, filterTemplates, type TemplateFacet } from '../src/catalog.js';

const templates = [
  { code: 'a', tags: { style: ['modern'], color: ['white'] } },
  { code: 'b', tags: { style: ['classic'], color: ['white', 'blue'] } },
  { code: 'c', tags: { style: ['modern', 'bold'], color: ['dark'] } },
  { code: 'd' },
];
const facets: TemplateFacet[] = [
  { code: 'style', name: 'Style', values: [{ code: 'modern', name: 'Modern' }, { code: 'classic', name: 'Classic' }, { code: 'bold', name: 'Bold' }] },
  { code: 'color', name: 'Color', values: [{ code: 'white', name: 'White' }, { code: 'dark', name: 'Dark' }] },
];
const codes = (list: { code: string }[]) => list.map((t) => t.code);

describe('template filters', () => {
  it('shows everything without filters', () => {
    expect(codes(filterTemplates(templates, {}))).toEqual(['a', 'b', 'c', 'd']);
    expect(codes(filterTemplates(templates, { style: [] }))).toEqual(['a', 'b', 'c', 'd']);
  });

  it('matches any value within a facet and every facet', () => {
    expect(codes(filterTemplates(templates, { style: ['modern', 'classic'] }))).toEqual(['a', 'b', 'c']);
    expect(codes(filterTemplates(templates, { style: ['modern'], color: ['white'] }))).toEqual(['a']);
  });

  it('counts each value against the other facets only', () => {
    const counts = facetCounts(templates, facets, { style: ['modern'] });
    expect(counts.style).toEqual({ modern: 2, classic: 1, bold: 1 });
    expect(counts.color).toEqual({ white: 1, dark: 1 });
  });
});
