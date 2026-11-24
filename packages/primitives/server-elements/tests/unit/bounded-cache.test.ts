import { describe, expect, it } from 'vitest';
import { BoundedCache } from '../../src/bounded-cache.js';
import { createStateSealer } from '../../src/state-sealer.js';

describe('BoundedCache', () => {
  it('evicts the least recently used entry once over capacity', () => {
    const cache = new BoundedCache<string, number>(2);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.get('a');
    cache.set('c', 3);
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('a')).toBe(1);
    expect(cache.get('c')).toBe(3);
    expect(cache.size).toBe(2);
  });

  it('never grows past its capacity however many keys pass through', () => {
    const cache = new BoundedCache<number, number>(8);
    for (let key = 0; key < 10_000; key++) cache.set(key, key);
    expect(cache.size).toBe(8);
  });

  it('rejects a capacity that cannot hold an entry', () => {
    expect(() => new BoundedCache(0)).toThrow(RangeError);
    expect(() => new BoundedCache(1.5)).toThrow(RangeError);
  });
});

describe('derived key cache under many secrets', () => {
  it('still seals and opens with every secret after the cache has turned over', async () => {
    const secrets = Array.from({ length: 40 }, (_, index) => `rotating-secret-number-${index}-padding-32`);
    // The first secrets have been evicted by the time the loop ends, so the second pass derives them again.
    for (const pass of [0, 1]) {
      for (const secret of secrets) {
        const sealer = createStateSealer(secret, true);
        const wire = await sealer.seal('x-el', { n: pass });
        expect(await sealer.open('x-el', wire)).toEqual({ n: pass });
      }
    }
  });
});
