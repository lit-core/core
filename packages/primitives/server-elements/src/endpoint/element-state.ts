import { canonicalizeJson } from '../crypto.js';

/** Reactive property declaration as exposed by Lit's `elementProperties` or `static properties`. */
export interface PropertyDeclaration {
  state?: boolean;
  [option: string]: unknown;
}

export type DeclaredProperties = Record<string, PropertyDeclaration>;

/** Structural equality over JSON-like values, using canonical serialization for objects. */
export function canonicalEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') {
    return false;
  }
  return canonicalizeJson(a) === canonicalizeJson(b);
}

/**
 * Clones a state value so later in-place mutation cannot alias the snapshot it was taken from.
 * Falls back to a JSON round trip for values `structuredClone` rejects, and finally to the value itself.
 */
export function cloneStateValue<T>(value: T): T {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  try {
    return structuredClone(value);
  } catch {
    try {
      return JSON.parse(JSON.stringify(value));
    } catch {
      return value;
    }
  }
}

function asDeclaration(decl: unknown): PropertyDeclaration {
  return decl !== null && typeof decl === 'object' ? (decl as PropertyDeclaration) : {};
}

/**
 * Collects every reactive property declared on an element class, merging Lit's finalized
 * `elementProperties` with the raw `static properties` map.
 */
export function collectDeclaredProperties(ElementClass: any): DeclaredProperties {
  const merged: DeclaredProperties = {};
  try {
    ElementClass?.finalize?.();
  } catch {}

  if (ElementClass?.elementProperties instanceof Map) {
    for (const [key, decl] of ElementClass.elementProperties.entries()) {
      if (typeof key === 'string') {
        merged[key] = asDeclaration(decl);
      }
    }
  }
  if (ElementClass?.properties && typeof ElementClass.properties === 'object') {
    for (const [key, decl] of Object.entries(ElementClass.properties)) {
      if (!Object.hasOwn(merged, key)) {
        merged[key] = asDeclaration(decl);
      }
    }
  }
  return merged;
}

/** Resolves the build id an element class was compiled under, falling back to the server default. */
export function resolveServerBuildId(ElementClass: any, fallback?: string): string {
  const fromClass = ElementClass?.__litBuildId;
  return typeof fromClass === 'string' && fromClass.length > 0 ? fromClass : (fallback ?? '');
}
