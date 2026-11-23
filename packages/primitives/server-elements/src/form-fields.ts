const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Collects submitted form fields into an argument object.
 *
 * Repeated names become arrays, and keys that could pollute a prototype are dropped. The object has
 * no prototype of its own. Shared by the browser (`FormData`) and the server (`URLSearchParams`), so
 * both transports hand an action identical input.
 */
export function createFieldCollector(): { add(key: string, value: unknown): void; result: Record<string, unknown> } {
  const result: Record<string, unknown> = Object.create(null);
  return {
    result,
    add(key, value) {
      if (FORBIDDEN_KEYS.has(key)) return;
      if (!Object.hasOwn(result, key)) {
        result[key] = value;
      } else if (Array.isArray(result[key])) {
        (result[key] as unknown[]).push(value);
      } else {
        result[key] = [result[key], value];
      }
    },
  };
}
