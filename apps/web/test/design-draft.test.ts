import { beforeEach, describe, expect, it } from 'vitest';
import { clearDraft, loadDraft, saveDraft, type Draft } from '../lib/design-draft.js';

const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  globalThis.localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  } as Storage;
});

const draft: Draft = {
  state: { selection: { size: 'std_3_5x2' }, quantity: 500 },
  design: { templateCode: 'classic', values: { name: 'Jamie', logo: 'data:image/png;base64,AAAA' } },
  mode: 'template',
};

describe('design draft', () => {
  it('round-trips and clears', () => {
    saveDraft('business-cards', draft);
    expect(loadDraft('business-cards')).toEqual(draft);
    clearDraft('business-cards');
    expect(loadDraft('business-cards')).toBeNull();
  });

  it('keeps a separate draft for each product', () => {
    saveDraft('business-cards', draft);
    expect(loadDraft('premium-cards')).toBeNull();
  });

  it('leaves out a logo too big for storage but keeps the rest', () => {
    saveDraft('business-cards', { ...draft, design: { ...draft.design, values: { name: 'Jamie', logo: `data:image/png;base64,${'A'.repeat(1_100_000)}` } } });
    expect(loadDraft('business-cards')?.design.values).toEqual({ name: 'Jamie' });
  });

  it('ignores broken or blocked storage', () => {
    store.set('business-card-draft-v1:business-cards', '{not json');
    expect(loadDraft('business-cards')).toBeNull();
    globalThis.localStorage = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    } as unknown as Storage;
    expect(() => saveDraft('business-cards', draft)).not.toThrow();
    expect(loadDraft('business-cards')).toBeNull();
  });
});
