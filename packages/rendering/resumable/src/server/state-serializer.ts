import { parse as devalueParse, stringify as devalueStringify } from 'devalue';

export { devalueParse as parseDevalueState, devalueStringify as stringifyDevalueState };

export interface StateSerializerOptions {
  /**
   * Property keys to explicitly exclude from serialization.
   */
  excludeProperties?: string[];

  /**
   * Custom filter predicate for determining if a property should be serialized.
   */
  filter?: (key: string, value: unknown) => boolean;
}

const DEFAULT_EXCLUDED_PROPERTIES = new Set<string>([
  'tagName',
  'shadowRoot',
  'isConnected',
  'nodeType',
  'nodeName',
  'localName',
  'namespaceURI',
  'renderOptions',
  'hasUpdated',
  'isUpdatePending',
  'updateComplete',
]);

const ctorCandidateKeysCache = new WeakMap<Function, readonly string[]>();

/**
 * Check if a value is JSON-serializable (primitives, plain objects, arrays).
 */
export function isSerializableValue(value: unknown, seen?: WeakSet<object>): boolean {
  if (value === null) return true;
  const t = typeof value;
  if (t === 'string' || t === 'boolean') {
    return true;
  }
  if (t === 'number') {
    return Number.isFinite(value as number);
  }
  if (t === 'object') {
    const visited = seen ?? new WeakSet<object>();
    if (visited.has(value as object)) {
      return false;
    }
    visited.add(value as object);

    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) {
        if (!isSerializableValue(value[i], visited)) {
          return false;
        }
      }
      return true;
    }
    // Must be a plain object, not a DOM node or class instance
    if (typeof Node !== 'undefined' && value instanceof Node) return false;
    const proto = Object.getPrototypeOf(value);
    if (proto === Object.prototype || proto === null) {
      const keys = Object.keys(value as Record<string, unknown>);
      for (let i = 0; i < keys.length; i++) {
        if (!isSerializableValue((value as Record<string, unknown>)[keys[i]], visited)) {
          return false;
        }
      }
      return true;
    }
  }
  return false;
}

function isWritableInstanceProperty(target: any, key: string): boolean {
  let cur = target;
  while (cur && cur !== Object.prototype) {
    const desc = Object.getOwnPropertyDescriptor(cur, key);
    if (desc) {
      if ('value' in desc) {
        return desc.writable !== false;
      }
      return typeof desc.set === 'function';
    }
    cur = Object.getPrototypeOf(cur);
  }
  return true;
}

function getStaticWritableKeysForCtor(ctor: Function): readonly string[] | null {
  const cached = ctorCandidateKeysCache.get(ctor);
  if (cached !== undefined) {
    return cached;
  }

  const c = ctor as any;
  const hasElementProps = c.elementProperties instanceof Map;
  const hasStaticProps = Boolean(c.properties && typeof c.properties === 'object');
  if (!hasElementProps && !hasStaticProps) {
    return null;
  }

  const rawSet = new Set<string>();
  if (hasElementProps) {
    for (const key of c.elementProperties.keys()) {
      if (typeof key === 'string' && !DEFAULT_EXCLUDED_PROPERTIES.has(key)) {
        rawSet.add(key);
      }
    }
  }
  if (hasStaticProps) {
    for (const key of Object.keys(c.properties)) {
      if (!DEFAULT_EXCLUDED_PROPERTIES.has(key)) {
        rawSet.add(key);
      }
    }
  }

  const proto = c.prototype;
  const writableKeys: string[] = [];
  for (const key of rawSet) {
    if (isWritableInstanceProperty(proto, key)) {
      writableKeys.push(key);
    }
  }
  ctorCandidateKeysCache.set(ctor, writableKeys);
  return writableKeys;
}

/**
 * Extract serializable reactive property snapshot from a Lit component instance or property bag.
 */
export function extractComponentState(instanceOrProps: any, options: StateSerializerOptions = {}): Record<string, unknown> {
  const state: Record<string, unknown> = {};
  if (!instanceOrProps || typeof instanceOrProps !== 'object') {
    return state;
  }

  const extraExcluded = options.excludeProperties && options.excludeProperties.length > 0 ? new Set(options.excludeProperties) : null;
  const filterFn = options.filter;
  const ctor = instanceOrProps.constructor;
  const staticKeys = typeof ctor === 'function' && ctor !== Object ? getStaticWritableKeysForCtor(ctor) : null;

  if (staticKeys !== null && staticKeys.length > 0) {
    for (let i = 0; i < staticKeys.length; i++) {
      const key = staticKeys[i];
      if (extraExcluded?.has(key)) continue;
      if (Object.hasOwn(instanceOrProps, key)) {
        const ownDesc = Object.getOwnPropertyDescriptor(instanceOrProps, key);
        if (ownDesc && 'value' in ownDesc && ownDesc.writable === false) continue;
      }

      let value: unknown;
      try {
        value = instanceOrProps[key];
      } catch {
        continue;
      }

      if (value === undefined) continue;
      if (filterFn && !filterFn(key, value)) continue;

      if (isSerializableValue(value)) {
        state[key] = value;
      }
    }
    return state;
  }

  const ownKeys = Object.keys(instanceOrProps);
  for (let i = 0; i < ownKeys.length; i++) {
    const key = ownKeys[i];
    if (key.startsWith('_') || key.startsWith('$')) continue;
    if (DEFAULT_EXCLUDED_PROPERTIES.has(key) || extraExcluded?.has(key)) continue;
    if (!isWritableInstanceProperty(instanceOrProps, key)) continue;

    let value: unknown;
    try {
      value = instanceOrProps[key];
    } catch {
      continue;
    }

    if (value === undefined) continue;
    if (filterFn && !filterFn(key, value)) continue;

    if (isSerializableValue(value)) {
      state[key] = value;
    }
  }

  return state;
}

/**
 * Check if a value contains rich non-JSON types supported by `devalue` (Date, Map, Set, RegExp, URL, BigInt).
 */
function hasRichDevalueTypes(value: unknown, seen?: WeakSet<object>): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'bigint') return true;
  if (typeof value === 'object') {
    if (value instanceof Date || value instanceof RegExp || value instanceof Map || value instanceof Set || (typeof URL !== 'undefined' && value instanceof URL)) {
      return true;
    }
    const visited = seen ?? new WeakSet<object>();
    if (visited.has(value as object)) return false;
    visited.add(value as object);
    if (Array.isArray(value)) {
      return value.some((item) => hasRichDevalueTypes(item, visited));
    }
    const proto = Object.getPrototypeOf(value);
    if (proto === Object.prototype || proto === null) {
      return Object.values(value as Record<string, unknown>).some((v) => hasRichDevalueTypes(v, visited));
    }
  }
  return false;
}

/**
 * Safely serialize state object to JSON string (or devalue format when rich types are present),
 * escaping '<' to prevent script breakouts.
 */
export function serializeStateToJson(state: Record<string, unknown>): string {
  if (hasRichDevalueTypes(state)) {
    try {
      return devalueStringify(state).replace(/</g, '\\u003c');
    } catch {
      // Fall through to JSON fallback
    }
  }
  try {
    return JSON.stringify(state).replace(/</g, '\\u003c');
  } catch {
    const seen = new WeakSet<object>();
    try {
      return JSON.stringify(state, (_key, val) => {
        if (typeof val === 'object' && val !== null) {
          if (seen.has(val)) {
            return undefined;
          }
          seen.add(val);
        }
        return val;
      }).replace(/</g, '\\u003c');
    } catch {
      return '{}';
    }
  }
}

/**
 * Serialize component instance or state dictionary into a JSON string or null if empty.
 */
export function serializeComponentState(instanceOrProps: any, options: StateSerializerOptions = {}): string | null {
  const state = extractComponentState(instanceOrProps, options);
  if (Object.keys(state).length === 0) {
    return null;
  }
  return serializeStateToJson(state);
}

function escapeStateAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

/**
 * Format the `data-lit-state` host attribute for serializing reactive component state on the custom element host.
 */
export function formatStateAttribute(stateJsonOrObj: string | Record<string, unknown>): string {
  const jsonStr = typeof stateJsonOrObj === 'string' ? stateJsonOrObj : serializeStateToJson(stateJsonOrObj);
  if (!jsonStr || jsonStr === '{}') {
    return '';
  }
  return `data-lit-state="${escapeStateAttr(jsonStr)}"`;
}

/**
 * Parse state from serialized `data-lit-state` attribute value (supporting both plain JSON and `devalue` payloads).
 */
export function parseComponentState(rawState: string): Record<string, unknown> {
  const trimmed = rawState?.trim();
  if (!trimmed) {
    return {};
  }
  if (trimmed.startsWith('[')) {
    try {
      return devalueParse(trimmed) as Record<string, unknown>;
    } catch {
      // Fallback to JSON.parse
    }
  }
  return JSON.parse(trimmed);
}
