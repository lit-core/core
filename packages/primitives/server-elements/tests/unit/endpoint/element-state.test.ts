import { describe, expect, it } from 'vitest';
import { canonicalEqual, cloneStateValue, collectDeclaredProperties, resolveServerBuildId } from '../../../src/endpoint/element-state.js';

describe('canonicalEqual', () => {
  it('compares plain values and structures by content', () => {
    expect(canonicalEqual(1, 1)).toBe(true);
    expect(canonicalEqual(Number.NaN, Number.NaN)).toBe(true);
    expect(canonicalEqual({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] })).toBe(true);
    expect(canonicalEqual({ a: 1 }, { a: 2 })).toBe(false);
    expect(canonicalEqual(null, {})).toBe(false);
    expect(canonicalEqual('1', 1)).toBe(false);
  });

  it('ignores key order', () => {
    expect(canonicalEqual({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
  });

  // A Map or Set never reaches this comparison: state holding one is refused when it is signed
  // (`assertJsonState`), so there is no state in which two different collections look equal.
});

describe('cloneStateValue', () => {
  it('returns an independent copy of nested values', () => {
    const original = { list: [1, 2], nested: { n: 1 } };
    const copy = cloneStateValue(original);
    original.list.push(3);
    original.nested.n = 9;
    expect(copy).toEqual({ list: [1, 2], nested: { n: 1 } });
  });

  it('keeps only the JSON-representable part of a value structuredClone rejects', () => {
    const copy = cloneStateValue({ n: 1, run: () => 1 });
    expect(copy).toEqual({ n: 1 });
  });

  it('returns a value neither clone nor JSON can handle as it is', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const withFn = Object.assign(cyclic, { run: () => 1 });
    expect(cloneStateValue(withFn)).toBe(withFn);
  });
});

describe('collectDeclaredProperties', () => {
  it('merges static properties and keeps the state flag', () => {
    const El = Object.assign(class {}, { properties: { count: { type: Number }, secret: { state: true } } });
    expect(collectDeclaredProperties(El)).toEqual({ count: { type: Number }, secret: { state: true } });
  });

  it('copes with a class that declares none', () => {
    expect(collectDeclaredProperties(class {})).toEqual({});
    expect(collectDeclaredProperties(undefined)).toEqual({});
  });
});

describe('resolveServerBuildId', () => {
  it('prefers the compiled build id, then the fallback, then empty', () => {
    expect(resolveServerBuildId({ __litBuildId: 'b1' }, 'fb')).toBe('b1');
    expect(resolveServerBuildId({}, 'fb')).toBe('fb');
    expect(resolveServerBuildId({ __litBuildId: '' })).toBe('');
  });
});
