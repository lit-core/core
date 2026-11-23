import { describe, expect, it } from 'vitest';
import { canonicalizeJson, escapeJsonForHtml, hasPrototypePollution } from '../../src/canonical-json.js';

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
