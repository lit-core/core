import { hasPrototypePollution, verifyStateSignature } from '../crypto.js';
import type { ActionMeta, ServerElementClass, ServerElementRegistry } from '../metadata.js';
import { ACTION_HASH_PATTERN, FORM_TICKET_SEQ } from '../protocol.js';
import { type ReplayGuard, remainingTtlMs } from '../replay-guard.js';
import { type OpenedActionRequest, StateOpenError, type StateSealer } from '../state-sealer.js';
import type { ActionRequestBody } from '../types.js';
import { BodyTooLargeError, DEFAULT_MAX_BODY_BYTES, readTextWithLimit } from './body.js';
import { evaluateCsrf } from './csrf.js';
import { resolveServerBuildId } from './element-state.js';
import { EndpointError, payloadTooLarge } from './endpoint-error.js';
import { isFormRequest, readFormPayload } from './form-payload.js';

const STATE_SIGNATURE_PATTERN = /^\d+\.[0-9a-f]{64}$/i;

export interface RequestPolicy {
  routePrefix: string;
  allowedOrigins?: readonly string[];
  secret: string | CryptoKey;
  customElements: ServerElementRegistry | undefined;
  /** Build id applied when the element class was not compiled with one. */
  buildIdFallback?: string;
  /** When set, every snapshot signature may be used once. */
  replayGuard?: ReplayGuard;
  /** Opens the state the client echoed: a no-op for readable state, decryption for encrypted state. */
  sealer: StateSealer;
  /** Largest request body to read, in bytes. */
  maxBodyBytes?: number;
}

export interface ValidatedActionRequest {
  /** The request with its state opened to plaintext. */
  body: OpenedActionRequest;
  ElementClass: ServerElementClass;
  actionMeta: ActionMeta;
  validatedArgs: unknown[];
  actionToken: string;
  serverBuildId: string;
  /** Present when the action was submitted as a plain HTML form rather than through `fetch`. */
  form?: { redirect: string | null };
}

/**
 * Ties a compiler-generated validator failure to the input field it concerns.
 *
 * The validator reports where it failed as `error.cause.path` (`qty`, `fields.email`, `tags[*]`).
 * A failure inside an object argument is keyed by the property path within it, which is the input
 * name when the action takes a form's fields as one object; a failure of the argument itself is
 * keyed by the argument name.
 */
function fieldsFromValidationError(err: unknown): Record<string, string> | undefined {
  const path = (err as { cause?: { path?: unknown } } | null)?.cause?.path;
  if (typeof path !== 'string' || path === '') return undefined;
  const inner = path.includes('.') ? path.slice(path.indexOf('.') + 1) : path;
  const key = inner.replace(/\[\*\]$/, '');
  return key ? { [key]: (err as Error).message } : undefined;
}

/** Extracts and shape-checks the action hash from the request path. */
export function parseActionHash(url: URL, routePrefix: string): string {
  // The client and `actionUrl()` join the prefix and the hash with exactly one slash, so accept the prefix either way.
  const prefix = routePrefix.endsWith('/') ? routePrefix : `${routePrefix}/`;
  if (!url.pathname.startsWith(prefix)) {
    throw new EndpointError(404, 'NOT_FOUND', 'Not Found');
  }
  const actionHash = url.pathname.slice(prefix.length).replace(/\/$/, '');
  if (!ACTION_HASH_PATTERN.test(actionHash)) {
    throw new EndpointError(400, 'INVALID_HASH', 'Invalid action hash format');
  }
  return actionHash;
}

function assertSameOrigin(request: Request, url: URL, allowedOrigins?: readonly string[]): void {
  const verdict = evaluateCsrf({
    origin: request.headers.get('Origin'),
    secFetchSite: request.headers.get('Sec-Fetch-Site'),
    hasCredentials: Boolean(request.headers.get('Cookie')),
    serverOrigin: url.origin,
    allowedOrigins,
  });
  if (!verdict.allowed) {
    throw new EndpointError(403, 'CSRF_BLOCKED', verdict.message);
  }
}

async function readActionBody(request: Request, limit: number): Promise<ActionRequestBody> {
  let text: string;
  try {
    text = await readTextWithLimit(request, limit);
  } catch (err) {
    if (err instanceof BodyTooLargeError) {
      throw payloadTooLarge(limit, true);
    }
    throw new EndpointError(400, 'INVALID_PAYLOAD', 'Failed to read request body');
  }

  let body: ActionRequestBody;
  try {
    body = JSON.parse(text);
  } catch {
    throw new EndpointError(400, 'INVALID_JSON', 'Invalid JSON request payload');
  }
  if (!body || typeof body !== 'object' || !body.tag || !Array.isArray(body.args)) {
    throw new EndpointError(400, 'INVALID_PAYLOAD', 'Malformed action request body');
  }
  if (hasPrototypePollution(body)) {
    throw new EndpointError(400, 'PROTOTYPE_POLLUTION', 'Prototype pollution payload rejected');
  }
  return body;
}

/**
 * Runs every pre-execution check, in a fixed order, and returns the facts the executor needs.
 *
 * Order matters: cheap, unauthenticated rejections (origin, size, shape) run before any
 * cryptography, and the signature is verified before the action is even looked up. The replay
 * claim comes last, so only a request that will actually run the action consumes its snapshot.
 */
export async function validateActionRequest(request: Request, url: URL, policy: RequestPolicy): Promise<ValidatedActionRequest> {
  const actionHash = parseActionHash(url, policy.routePrefix);
  assertSameOrigin(request, url, policy.allowedOrigins);
  const limit = policy.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
  const form = isFormRequest(request) ? await readFormPayload(request, limit) : undefined;
  const body = form?.body ?? (await readActionBody(request, limit));

  const ElementClass = policy.customElements?.get ? policy.customElements.get(body.tag) : undefined;
  if (!ElementClass) {
    throw new EndpointError(404, 'ELEMENT_NOT_FOUND', `Element '<${body.tag}>' not found`);
  }

  const serverBuildId = resolveServerBuildId(ElementClass, policy.buildIdFallback);
  const clientBuildId = body.attrs?.['data-lit-build-id'];
  if (clientBuildId !== undefined && clientBuildId !== serverBuildId) {
    throw new EndpointError(409, 'ACTION_STALE', `Action state is stale (build mismatch: client ${clientBuildId || 'none'} vs server ${serverBuildId || 'none'})`);
  }

  if (typeof body.sig !== 'string' || !STATE_SIGNATURE_PATTERN.test(body.sig)) {
    throw new EndpointError(403, 'STATE_TAMPERED', 'Missing or malformed state signature');
  }

  // The signature leads with its own expiry time. A page left open past it is not tampered with, it is old,
  // and the browser needs to hear that so it can offer a reload instead of an alarming signature error.
  const expiresAt = Number(body.sig.slice(0, body.sig.indexOf('.')));
  if (Date.now() > expiresAt) {
    throw new EndpointError(409, 'STATE_EXPIRED', 'This page has expired. Reload to continue.');
  }

  // A form is signed as a ticket at its reserved sequence number; a fetch request must carry a real snapshot sequence.
  const snapshotSeq = form ? FORM_TICKET_SEQ : (body.snapshotSeq ?? 0);
  if (!form && (!Number.isSafeInteger(snapshotSeq) || snapshotSeq < 0)) {
    throw new EndpointError(400, 'INVALID_PAYLOAD', 'Invalid snapshot sequence');
  }

  const actionToken = form ? form.token : request.headers.get('X-Lit-Action-Token') || '';
  const bodyToken = body.attrs?.['data-lit-token'];
  if (!actionToken || (bodyToken !== undefined && bodyToken !== actionToken)) {
    throw new EndpointError(403, 'TOKEN_MISMATCH', 'Action token mismatch');
  }

  // A form carries a ticket and no state, so there is nothing for the sealer to open, encrypted or not.
  let openedState: Record<string, unknown>;
  try {
    openedState = form ? {} : await policy.sealer.open(body.tag, body.state ?? {});
  } catch (err) {
    if (err instanceof StateOpenError) {
      throw new EndpointError(403, 'STATE_TAMPERED', err.message);
    }
    throw err;
  }
  const opened: OpenedActionRequest = { ...body, state: openedState };

  const authentic = await verifyStateSignature(body.tag, openedState, body.sig, policy.secret, {
    buildId: serverBuildId,
    seq: snapshotSeq,
    publicAttrs: body.attrs,
    token: actionToken,
  });
  if (!authentic) {
    throw new EndpointError(403, 'STATE_TAMPERED', 'Invalid or expired state signature');
  }

  const actionMeta: ActionMeta | undefined = ElementClass.__lit_actions?.[actionHash];
  if (!actionMeta) {
    throw new EndpointError(404, 'ACTION_NOT_FOUND', `Action '${actionHash}' not found on <${body.tag}>`);
  }

  let validatedArgs: unknown[];
  try {
    validatedArgs = typeof actionMeta.validate === 'function' ? actionMeta.validate(body.args) : body.args;
  } catch (err: any) {
    throw new EndpointError(400, 'VALIDATION_ERROR', err?.message || 'Validation error', fieldsFromValidationError(err));
  }

  // Claimed last: a request rejected above never reached the action, so its snapshot stays usable for the corrected retry.
  if (policy.replayGuard && !(await policy.replayGuard.claim(body.sig, remainingTtlMs(body.sig)))) {
    throw new EndpointError(409, 'STATE_REPLAYED', 'This state snapshot was already used. Reload to continue.');
  }

  return { body: opened, ElementClass, actionMeta, validatedArgs, actionToken, serverBuildId, form: form && { redirect: form.redirect } };
}
