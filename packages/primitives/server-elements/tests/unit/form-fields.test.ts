import { describe, expect, it } from 'vitest';
import { createFieldCollector } from '../../src/form-fields.js';

describe('createFieldCollector', () => {
  it('collects single values as they are', () => {
    const fields = createFieldCollector();
    fields.add('title', 'hello');
    expect(fields.result).toEqual({ title: 'hello' });
  });

  it('turns repeated names into arrays, in submission order', () => {
    const fields = createFieldCollector();
    fields.add('tag', 'a');
    fields.add('tag', 'b');
    fields.add('tag', 'c');
    expect(fields.result.tag).toEqual(['a', 'b', 'c']);
  });

  it('drops keys that could pollute a prototype', () => {
    const fields = createFieldCollector();
    fields.add('__proto__', 'x');
    fields.add('constructor', 'x');
    fields.add('prototype', 'x');
    expect(Object.keys(fields.result)).toEqual([]);
    expect(({} as Record<string, unknown>).x).toBeUndefined();
  });

  it('returns an object with no prototype', () => {
    expect(Object.getPrototypeOf(createFieldCollector().result)).toBeNull();
  });
});
