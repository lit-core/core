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

/**
 * Check if a value is JSON-serializable (primitives, plain objects, arrays).
 */
export function isSerializableValue(value: unknown): boolean {
  if (value === null) return true;
  const t = typeof value;
  if (t === 'string' || t === 'number' || t === 'boolean') {
    return Number.isFinite(value as number) || t !== 'number';
  }
  if (t === 'object') {
    if (Array.isArray(value)) {
      return value.every(isSerializableValue);
    }
    // Must be a plain object, not a DOM node or class instance
    if (value instanceof Node) return false;
    const proto = Object.getPrototypeOf(value);
    if (proto === Object.prototype || proto === null) {
      for (const key of Object.keys(value as Record<string, unknown>)) {
        if (!isSerializableValue((value as Record<string, unknown>)[key])) {
          return false;
        }
      }
      return true;
    }
  }
  return false;
}

/**
 * Extract serializable reactive property snapshot from a Lit component instance or property bag.
 */
export function extractComponentState(instanceOrProps: any, options: StateSerializerOptions = {}): Record<string, unknown> {
  const state: Record<string, unknown> = {};
  if (!instanceOrProps || typeof instanceOrProps !== 'object') {
    return state;
  }

  const excludeSet = new Set(options.excludeProperties || []);

  // Determine property keys to inspect
  const candidateKeys = new Set<string>();

  // 1. Inspect static elementProperties from LitElement / ReactiveElement
  const ctor = instanceOrProps.constructor;
  if (ctor && ctor.elementProperties instanceof Map) {
    for (const key of ctor.elementProperties.keys()) {
      if (typeof key === 'string') {
        candidateKeys.add(key);
      }
    }
  }

  // 2. Inspect static properties object
  if (ctor?.properties && typeof ctor.properties === 'object') {
    for (const key of Object.keys(ctor.properties)) {
      candidateKeys.add(key);
    }
  }

  // 3. If no static metadata, inspect instance's own properties
  if (candidateKeys.size === 0) {
    for (const key of Object.keys(instanceOrProps)) {
      if (!key.startsWith('_') && !key.startsWith('$')) {
        candidateKeys.add(key);
      }
    }
  }

  for (const key of candidateKeys) {
    if (excludeSet.has(key)) continue;

    let value: unknown;
    try {
      value = instanceOrProps[key];
    } catch {
      continue;
    }

    if (value === undefined) continue;

    if (options.filter && !options.filter(key, value)) {
      continue;
    }

    if (isSerializableValue(value)) {
      state[key] = value;
    }
  }

  return state;
}

/**
 * Safely serialize state object to JSON string, escaping '<' to prevent script breakouts.
 */
export function serializeStateToJson(state: Record<string, unknown>): string {
  return JSON.stringify(state).replace(/</g, '\\u003c');
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

/**
 * Render the <script type="lit/state"> tag for embedding inside the custom element host.
 */
export function renderStateScript(stateJsonOrObj: string | Record<string, unknown>): string {
  const jsonStr = typeof stateJsonOrObj === 'string' ? stateJsonOrObj : serializeStateToJson(stateJsonOrObj);

  return `<script type="lit/state">${jsonStr}</script>`;
}

/**
 * Parse state from serialized script text content.
 */
export function parseComponentState(scriptContent: string): Record<string, unknown> {
  if (!scriptContent?.trim()) {
    return {};
  }
  return JSON.parse(scriptContent.trim());
}
