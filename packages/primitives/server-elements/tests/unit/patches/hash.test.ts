import { describe, expect, it } from 'vitest';
import { hash64 } from '../../../src/patches/hash.js';
import { extractTemplateId } from '../../../src/patches/template-id.js';

describe('hash64', () => {
  it('is deterministic and 16 hex characters', () => {
    expect(hash64(['hello'])).toBe(hash64(['hello']));
    expect(hash64(['hello'])).toMatch(/^[0-9a-f]{16}$/);
  });

  it('distinguishes part boundaries', () => {
    expect(hash64(['ab', 'c'])).not.toBe(hash64(['a', 'bc']));
    expect(hash64(['', 'a'])).not.toBe(hash64(['a', '']));
  });

  it('shows no collisions across 100k similar strings', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 100_000; i++) seen.add(hash64([`<li data-id="${i}">item ${i}</li>`]));
    expect(seen.size).toBe(100_000);
  });
});

describe('extractTemplateId', () => {
  it('prefers the compiled build-time id', () => {
    expect(extractTemplateId({ _$litType$: { h: 'abc123' }, strings: ['x'] })).toBe('abc123');
  });

  it('hashes static strings for standard templates', () => {
    const a = extractTemplateId({ strings: ['<p>', '</p>'], values: [1] });
    const b = extractTemplateId({ strings: ['<p>', '</p>'], values: [2] });
    expect(a).toBe(b);
    expect(a).not.toBe(extractTemplateId({ strings: ['<b>', '</b>'] }));
  });

  it('returns a stable placeholder for non-templates', () => {
    expect(extractTemplateId(null)).toBe('0000000000000000');
    expect(extractTemplateId('text')).toBe('0000000000000000');
    expect(extractTemplateId({})).toBe('0000000000000000');
  });
});
