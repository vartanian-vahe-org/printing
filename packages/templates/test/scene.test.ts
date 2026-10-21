import { describe, expect, it } from 'vitest';
import seed from '../seed/business-cards-templates.json' with { type: 'json' };
import { allFontFiles, availableWeight, fieldFamilies, unsupportedCharacters } from '../src/fonts.js';
import { parseLayout } from '../src/layout.js';
import { layoutFace, textLeft, textWidth, type MeasureText } from '../src/render.js';

const classic = parseLayout(seed.templates.find((t) => t.code === 'classic')!.layout);
const geometry = { widthIn: 3.5, heightIn: 2, bleedIn: 0.125, safeIn: 0.125 };
/** Every character 0.5em wide: easy to reason about. */
const halfEm: MeasureText = (text, font) => [...text].length * font.size * 0.5;

describe('fonts', () => {
  it('snaps weights to files that exist', () => {
    expect(availableWeight('sans', 600)).toBe(600);
    expect(availableWeight('sans', 900)).toBe(800);
    expect(availableWeight('serif', 800)).toBe(700);
    expect(availableWeight('serif', 300)).toBe(400);
    expect(availableWeight('sans', 450)).toBe(500);
  });

  it('lists one file per family and weight', () => {
    const files = allFontFiles();
    expect(files.map((f) => f.fileName)).toContain('Inter_600SemiBold.ttf');
    expect(files.find((f) => f.family === 'serif' && f.weight === 600)?.packageName).toBe('@expo-google-fonts/lora');
  });
});

describe('layoutFace', () => {
  it('places items in bleed-box points and keeps the visible area separate', () => {
    const scene = layoutFace({ layout: classic, side: 'front', values: { name: 'Jamie Rivera' }, geometry, area: 'bleed', useSamples: false, measure: halfEm });
    expect(scene.bleed).toEqual({ x: 0, y: 0, w: 270, h: 162 });
    expect(scene.trim).toEqual({ x: 9, y: 9, w: 252, h: 144 });
    expect(scene.view).toEqual(scene.bleed);
    const name = scene.items.find((i) => i.kind === 'text' && i.field === 'name');
    expect(name).toMatchObject({ kind: 'text', text: 'Jamie Rivera' });
  });

  it('leaves empty fields and the logo placeholder out of print scenes', () => {
    const scene = layoutFace({ layout: classic, side: 'front', values: {}, geometry, useSamples: false, measure: halfEm });
    expect(scene.items.some((i) => i.kind === 'text' || i.kind === 'placeholder')).toBe(false);
  });

  it('shrinks long text to the max width, measured with the same function painters use', () => {
    const long = 'A very long company name that never fits';
    const scene = layoutFace({ layout: classic, side: 'front', values: { name: long }, geometry, useSamples: false, measure: halfEm });
    const item = scene.items.find((i) => i.kind === 'text' && i.field === 'name');
    if (item?.kind !== 'text') throw new Error('no text');
    const element = classic.front.elements.find((e) => e.type === 'text' && e.field === 'name');
    if (element?.type !== 'text') throw new Error('no element');
    expect(item.font.size).toBeLessThan(element.size);
    const width = textWidth(item, halfEm);
    expect(textLeft(item, width)).toBeGreaterThanOrEqual(0);
  });
});

describe('font coverage', () => {
  it('knows which characters the fonts can print', () => {
    expect(unsupportedCharacters('Jamie Rivera & Co. (213) 555-0100 café Nguyễn Văn Đức', 'sans')).toEqual([]);
    expect(unsupportedCharacters('Jamie 😀 王', 'sans')).toEqual(['😀', '王']);
    expect(unsupportedCharacters('Ünïcödé', 'serif')).toEqual([]);
    expect(fieldFamilies(classic, 'name')).toEqual(['sans']);
  });
});
