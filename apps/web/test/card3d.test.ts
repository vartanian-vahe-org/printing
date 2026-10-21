import { resolveSize } from '@printing/pricing';
import { describe, expect, it } from 'vitest';
import { businessCards, defaultSelection } from '../../../packages/pricing/test/fixtures/business-cards.js';
import { cameraDistance, cardSpec, faceUv, finishMaterial } from '../lib/card3d.js';

const std = resolveSize(businessCards, 'std_3_5x2');

describe('cardSpec', () => {
  it('maps paper, corners and coating to card geometry and finishes', () => {
    const spec = cardSpec(businessCards, { ...defaultSelection, paper: '16pt', corners: 'rounded_quarter', coating: 'uv_front_uncoated_back' }, std);
    expect(spec).toEqual({
      widthIn: 3.5,
      heightIn: 2,
      thicknessIn: 0.016,
      radiusIn: 0.25,
      frontFinish: 'uv',
      backFinish: 'none',
      backMode: 'separate',
    });
  });

  it('does not show UV on a blank back (spec §3.1)', () => {
    const spec = cardSpec(businessCards, { ...defaultSelection, coating: 'uv_both', printed_side: 'front_only' }, std);
    expect(spec.frontFinish).toBe('uv');
    expect(spec.backFinish).toBe('none');
    expect(spec.backMode).toBe('blank');
  });

  it('keeps gloss on a blank back (coating is applied to both sides)', () => {
    const spec = cardSpec(businessCards, { ...defaultSelection, coating: 'gloss_both', printed_side: 'front_only' }, std);
    expect(spec.backFinish).toBe('gloss');
  });

  it('clamps the corner radius to half the short side', () => {
    const tiny = { ...std, widthIn: 0.4, heightIn: 0.3 };
    expect(cardSpec(businessCards, { ...defaultSelection, corners: 'rounded_quarter' }, tiny).radiusIn).toBe(0.15);
  });
});

describe('finishMaterial', () => {
  it('orders finishes from shiny to rough', () => {
    const r = (f: Parameters<typeof finishMaterial>[0]) => finishMaterial(f).roughness;
    expect(r('uv')).toBeLessThan(r('gloss'));
    expect(r('gloss')).toBeLessThan(r('silk'));
    expect(r('silk')).toBeLessThan(r('matte'));
    expect(r('matte')).toBeLessThan(r('none'));
    expect(finishMaterial('uv').clearcoat).toBe(1);
    expect(finishMaterial('none').paperGrain).toBe(true);
    expect(finishMaterial('soft_touch').sheen).toBeGreaterThan(0);
  });
});

describe('geometry helpers', () => {
  it('maps the card corners to UV 0..1', () => {
    expect(faceUv(-1.75, -1, 3.5, 2)).toEqual([0, 0]);
    expect(faceUv(1.75, 1, 3.5, 2)).toEqual([1, 1]);
  });

  it('pulls the camera back for wider cards on a narrow canvas', () => {
    expect(cameraDistance({ widthIn: 3.5, heightIn: 2 }, 35, 0.6)).toBeGreaterThan(cameraDistance({ widthIn: 3.5, heightIn: 2 }, 35, 1.6));
  });
});
