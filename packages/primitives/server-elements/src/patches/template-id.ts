import { hash64 } from './hash.js';

const UNKNOWN_TEMPLATE_ID = '0000000000000000';

/**
 * Resolves a stable fingerprint for a Lit template result.
 *
 * Compiled templates carry a build-time id in `_$litType$.h`. Standard templates fall back to a
 * content hash of their static strings, so two renders of the same source template agree.
 */
export function extractTemplateId(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return UNKNOWN_TEMPLATE_ID;
  }
  const result = value as { _$litType$?: unknown; strings?: unknown };
  const litType = result._$litType$;
  if (litType !== null && typeof litType === 'object') {
    const compiledId = (litType as { h?: unknown }).h;
    if (typeof compiledId === 'string') {
      return compiledId;
    }
  }
  if (Array.isArray(result.strings)) {
    return hash64(result.strings as readonly string[]);
  }
  return UNKNOWN_TEMPLATE_ID;
}
