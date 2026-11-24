import { describe, expect, it } from 'vitest';
import { assertJsonState, canonicalizeJson, escapeJsonForHtml, hasPrototypePollution, NonJsonStateError } from '../../src/canonical-json.js';

describe('canonicalizeJson', () => {
  it('sorts keys so equal objects serialize identically', () => {
    expect(canonicalizeJson({ b: 1, a: { d: 2, c: 3 } })).toBe(canonicalizeJson({ a: { c: 3, d: 2 }, b: 1 }));
  });

  it('matches JSON for plain values', () => {
    expect(canonicalizeJson({ a: [1, 'x', null, true] })).toBe('{"a":[1,"x",null,true]}');
  });

  it('serializes missing array entries as null, as JSON does, so they never collide with a shorter array', () => {
    expect(canonicalizeJson([undefined])).toBe('[null]');
    expect(canonicalizeJson([() => 1, Symbol('s')])).toBe('[null,null]');
    expect(canonicalizeJson([undefined])).not.toBe(canonicalizeJson([]));
  });

  it('omits undefined, function and symbol object members', () => {
    expect(canonicalizeJson({ a: 1, b: undefined, c: () => 1, d: Symbol('s') })).toBe('{"a":1}');
  });

  it('strips prototype pollution keys', () => {
    const polluted = JSON.parse('{"a":1,"__proto__":{"x":1},"constructor":2}');
    expect(canonicalizeJson(polluted)).toBe('{"a":1}');
  });

  it('serializes dates as ISO strings', () => {
    expect(canonicalizeJson({ at: new Date(0) })).toBe('{"at":"1970-01-01T00:00:00.000Z"}');
  });
});

describe('hasPrototypePollution', () => {
  it('finds dangerous keys at any depth, including inside arrays', () => {
    expect(hasPrototypePollution(JSON.parse('{"a":[{"__proto__":1}]}'))).toBe(true);
    expect(hasPrototypePollution({ a: { b: { constructor: 1 } } })).toBe(true);
    expect(hasPrototypePollution({ a: [{ prototype: 1 }] })).toBe(true);
  });

  it('accepts ordinary data', () => {
    expect(hasPrototypePollution({ a: [1, { b: 'c' }], d: null })).toBe(false);
    expect(hasPrototypePollution('text')).toBe(false);
  });
});

describe('escapeJsonForHtml', () => {
  it('escapes characters that could end an attribute or script context', () => {
    expect(escapeJsonForHtml('{"a":"</script><b>&"}')).toBe('{"a":"\\u003c/script\\u003e\\u003cb\\u003e\\u0026"}');
  });

  it('escapes the line separators JSON allows but scripts do not', () => {
    expect(escapeJsonForHtml('"\u2028\u2029"')).toBe('"\\u2028\\u2029"');
  });
});

describe('assertJsonState', () => {
  const rejects = (value: unknown) => {
    try {
      assertJsonState(value);
    } catch (error) {
      return error as NonJsonStateError;
    }
    throw new Error('expected the state to be rejected');
  };

  it('accepts everything JSON can carry', () => {
    expect(() => assertJsonState({ n: 1, s: 'x', b: false, nil: null, list: [1, { deep: [true] }], nested: { a: { b: 'c' } }, omitted: undefined })).not.toThrow();
    expect(() => assertJsonState(Object.assign(Object.create(null), { a: 1 }))).not.toThrow();
  });

  it('names the path and the kind of what it rejects', () => {
    const error = rejects({ items: [{ tags: new Set(['a']) }] });
    expect(error).toBeInstanceOf(NonJsonStateError);
    expect(error.path).toBe('items[0].tags');
    expect(error.found).toBe('Set');
    expect(error.message).toContain("'items[0].tags'");
  });

  it('rejects collections, dates and class instances, which come back from JSON as something else', () => {
    expect(rejects({ m: new Map([['a', 1]]) }).found).toBe('Map');
    expect(rejects({ at: new Date(0) }).found).toBe('Date');
    class Money {}
    expect(rejects({ price: new Money() }).found).toBe('Money');
    expect(rejects({ bytes: new Uint8Array(2) }).found).toBe('Uint8Array');
  });

  it('rejects values JSON cannot represent', () => {
    expect(rejects({ f: () => 1 }).found).toBe('function');
    expect(rejects({ s: Symbol('x') }).found).toBe('symbol');
    expect(rejects({ big: 10n }).found).toBe('bigint');
    expect(rejects({ n: Number.NaN }).found).toBe('NaN');
    expect(rejects({ n: Number.POSITIVE_INFINITY }).found).toBe('Infinity');
  });

  it('rejects an undefined array entry, which JSON turns into null, but not an undefined member', () => {
    expect(rejects({ list: [1, undefined] }).path).toBe('list[1]');
    expect(() => assertJsonState({ gone: undefined })).not.toThrow();
  });

  it('rejects a cycle instead of recursing forever', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(rejects(cyclic).found).toBe('circular reference');
  });
});
