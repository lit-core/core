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

/** Thrown when element state holds a value JSON cannot carry, so the browser would get something other than what the server holds. */
export class NonJsonStateError extends Error {
  constructor(
    /** Where in the state the value sits, such as `items[2].tags`. */
    readonly path: string,
    /** What was found there, such as `Map` or `function`. */
    readonly found: string,
  ) {
    super(`State holds a ${found} at '${path}', which does not survive the JSON wire format. Store plain data instead: an array of entries for a Map or Set, and an ISO string for a Date.`);
    this.name = 'NonJsonStateError';
  }
}

function describeNonJson(value: unknown): string | null {
  switch (typeof value) {
    case 'function':
      return 'function';
    case 'symbol':
      return 'symbol';
    case 'bigint':
      return 'bigint';
    case 'number':
      return Number.isFinite(value) ? null : String(value);
    case 'object': {
      if (value === null || Array.isArray(value)) return null;
      const prototype = Object.getPrototypeOf(value);
      if (prototype === Object.prototype || prototype === null) return null;
      return prototype?.constructor?.name || 'object with a custom prototype';
    }
    default:
      return null;
  }
}

/**
 * Requires state to be what JSON can carry: plain objects, arrays, strings, finite numbers, booleans and null.
 * Element state is signed and then echoed back by the browser as JSON, so anything else (a `Map`, a `Date`,
 * a class instance, `NaN`) would come back as something different from what was signed and was held.
 * An `undefined` object member is fine, since JSON drops it; an `undefined` array entry is not.
 */
export function assertJsonState(state: unknown, path = '', ancestors: object[] = []): void {
  const at = (key: string | number) => (typeof key === 'number' ? `${path}[${key}]` : path ? `${path}.${key}` : key);
  const found = describeNonJson(state);
  if (found) throw new NonJsonStateError(path || '(root)', found);
  if (state === null || typeof state !== 'object') return;
  if (ancestors.includes(state)) throw new NonJsonStateError(path || '(root)', 'circular reference');

  const next = [...ancestors, state];
  if (Array.isArray(state)) {
    state.forEach((item, index) => {
      if (item === undefined) throw new NonJsonStateError(at(index), 'undefined array entry');
      assertJsonState(item, at(index), next);
    });
    return;
  }
  for (const [key, value] of Object.entries(state)) {
    if (value !== undefined) assertJsonState(value, at(key), next);
  }
}
