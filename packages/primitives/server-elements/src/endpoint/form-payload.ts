import { hasPrototypePollution } from '../crypto.js';
import { createFieldCollector } from '../form-fields.js';
import { FORM_FIELD_PREFIX, FORM_TICKET_SEQ } from '../protocol.js';
import type { ActionRequestBody } from '../types.js';
import { BodyTooLargeError, DEFAULT_MAX_BODY_BYTES, readTextWithLimit } from './body.js';
import { EndpointError, payloadTooLarge } from './endpoint-error.js';

export interface FormPayload {
  body: ActionRequestBody;
  /** Per-element action token, carried in a hidden field because a plain form cannot set headers. */
  token: string;
  /** Where to send the browser after the action, as the page asked. Untrusted until checked. */
  redirect: string | null;
}

/** True for a plain HTML form submission (`application/x-www-form-urlencoded`). */
export function isFormRequest(request: Request): boolean {
  return (request.headers.get('content-type') || '').toLowerCase().startsWith('application/x-www-form-urlencoded');
}

function parseJsonField<T>(value: string | null, fallback: T, field: string): T {
  if (value === null || value === '') return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    throw new EndpointError(400, 'INVALID_PAYLOAD', `Malformed form field '${FORM_FIELD_PREFIX}${field}'`);
  }
}

/**
 * Reads a no-JavaScript form submission into the same request shape the fetch transport uses.
 *
 * The signed snapshot travels in hidden `_lit_*` fields (see `ServerElement.formFields()`); every
 * other field becomes the single argument object passed to the action.
 */
export async function readFormPayload(request: Request, limit: number = DEFAULT_MAX_BODY_BYTES): Promise<FormPayload> {
  let text: string;
  try {
    text = await readTextWithLimit(request, limit);
  } catch (err) {
    if (err instanceof BodyTooLargeError) {
      throw payloadTooLarge(limit, false);
    }
    throw new EndpointError(400, 'INVALID_PAYLOAD', 'Failed to read request body');
  }

  const params = new URLSearchParams(text);
  const reserved = (name: string) => params.get(`${FORM_FIELD_PREFIX}${name}`);

  const fields = createFieldCollector();
  for (const [key, value] of params) {
    if (!key.startsWith(FORM_FIELD_PREFIX)) fields.add(key, value);
  }

  const tag = reserved('tag');
  if (!tag) {
    throw new EndpointError(400, 'INVALID_PAYLOAD', 'Malformed action request body');
  }

  const token = reserved('token') ?? '';
  const body: ActionRequestBody = {
    tag,
    attrs: parseJsonField<Record<string, string>>(reserved('attrs'), {}, 'attrs'),
    // A form carries a ticket, not state: the endpoint rebuilds state from the element's loaders.
    state: {},
    sig: reserved('sig') ?? '',
    args: [fields.result],
    seq: 0,
    snapshotSeq: FORM_TICKET_SEQ,
  };
  if (hasPrototypePollution(body)) {
    throw new EndpointError(400, 'PROTOTYPE_POLLUTION', 'Prototype pollution payload rejected');
  }
  return { body, token, redirect: reserved('redirect') };
}
