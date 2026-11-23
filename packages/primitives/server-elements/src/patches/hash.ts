/**
 * Non-cryptographic 64-bit content hash built from two independent 32-bit lanes.
 *
 * Used only for change detection (keyed list item fingerprints and template ids), never for
 * authentication. A 32-bit hash would make an unrelated item edit collide with probability
 * 2^-32 per comparison and silently leave stale markup in the browser, so two lanes are used.
 *
 * Each part is length-delimited, so `['ab', 'c']` and `['a', 'bc']` hash differently.
 */
export function hash64(parts: Iterable<string>): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c64e6d;
  for (const part of parts) {
    for (let i = 0; i < part.length; i++) {
      const ch = part.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    // Length delimiter closes the part so concatenation boundaries are significant.
    h1 = Math.imul(h1 ^ (part.length + 0x9e3779b9), 2654435761);
    h2 = Math.imul(h2 ^ (part.length + 0x7f4a7c15), 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0');
}
