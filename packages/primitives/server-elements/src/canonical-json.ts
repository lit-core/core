/**
 * Checks recursively whether an object contains prototype-pollution keys
 * (__proto__, constructor, prototype).
 */
export function hasPrototypePollution(value: unknown): boolean {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  if (Array.isArray(value)) {
    return value.some(hasPrototypePollution);
  }
  for (const key of Object.getOwnPropertyNames(value)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
      return true;
    }
    if (hasPrototypePollution((value as Record<string, unknown>)[key])) {
      return true;
    }
  }
  return false;
}

/**
 * Serializes an object to deterministic canonical JSON with sorted keys
 * and prototype pollution properties stripped.
 */
export function canonicalizeJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    // `JSON.stringify` yields no string for undefined, functions and symbols; callers decide how to treat those.
    return JSON.stringify(value) ?? 'null';
  }
  if (value instanceof Date) {
    return JSON.stringify(value.toISOString());
  }
  if (Array.isArray(value)) {
    // Entries JSON cannot represent become null, as `JSON.stringify` does, so `[undefined]` never collides with `[]`.
    return `[${value.map(canonicalizeJson).join(',')}]`;
  }
  const sortedKeys = Object.keys(value as Record<string, unknown>).sort();
  const parts: string[] = [];
  for (const k of sortedKeys) {
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') {
      continue;
    }
    const v = (value as Record<string, unknown>)[k];
    if (v !== undefined && typeof v !== 'function' && typeof v !== 'symbol') {
      parts.push(`${JSON.stringify(k)}:${canonicalizeJson(v)}`);
    }
  }
  return `{${parts.join(',')}}`;
}

/**
 * Escapes sensitive HTML and Unicode control characters from JSON strings
 * before embedding in HTML attributes or scripts.
 */
export function escapeJsonForHtml(jsonStr: string): string {
  return jsonStr
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}
