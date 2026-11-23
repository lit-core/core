import { ServerActionError } from '../errors.js';
import { ACTION_ERROR_EVENT, ACTION_SUCCESS_EVENT, DEFAULT_ROUTE_PREFIX, PENDING_ATTRIBUTE } from '../protocol.js';
import type { ActionRequestBody, PatchFrame } from '../types.js';
import { type ClientElement, collectSignedAttributes, hydrateClientState, tagNameOf } from './element-state.js';
import { readFrames } from './frames.js';
import { executePatches } from './patch.js';

/** Detail carried by `lit-action-success` and `lit-action-error`. */
export interface ActionEventDetail {
  /** Name of the action, or its hash when no name is known. */
  action: string;
  /** The action's return value (success only). */
  result?: unknown;
  /** The failure (error only). A deliberate server `ActionError` arrives with its `code` and `fields`. */
  error?: Error;
}

/** Lets script on the page observe an action settling, including from stubs that have no action state. */
function announce(host: HTMLElement, type: string, detail: ActionEventDetail): void {
  if (typeof host.dispatchEvent === 'function' && typeof CustomEvent === 'function') {
    host.dispatchEvent(new CustomEvent<ActionEventDetail>(type, { bubbles: true, composed: true, detail }));
  }
}

export interface DispatchActionOptions {
  actionName?: string;
  routePrefix?: string;
}

/** Turns a non-2xx action response into a typed error, preferring the server's own message. */
async function toActionError(response: Response): Promise<ServerActionError> {
  const text = await response.text();
  let body: { message?: string; error?: string; code?: string; fields?: Record<string, string> } | null = null;
  try {
    body = JSON.parse(text);
  } catch {
    // Non-JSON error bodies (proxies, gateways) are reported verbatim.
  }
  const message = body?.message || body?.error || text || `Action request failed with status ${response.status}`;
  return new ServerActionError(message, body?.code || 'ACTION_ERROR', response.status, body?.fields);
}

function buildRequest(host: ClientElement, seq: number, args: unknown[]): { body: ActionRequestBody; token: string } {
  hydrateClientState(host);
  const token = host.getAttribute?.('data-lit-token') || host.__litToken || '';
  const body: ActionRequestBody = {
    tag: tagNameOf(host),
    attrs: collectSignedAttributes(host),
    state: host.__litState || {},
    sig: host.getAttribute?.('data-lit-sig') || host.__litSig || '',
    args,
    seq,
    snapshotSeq: host.__litSnapshotSeq ?? 0,
  };
  return { body, token };
}

/** Names of the actions each element is waiting on, in dispatch order, repeats included. */
const pendingActions = new WeakMap<object, string[]>();

/**
 * Mirrors an element's in-flight actions onto its attributes.
 *
 * A zero-Lit stub cannot re-render a pending state, so the host carries `data-lit-pending="save"` and
 * `aria-busy="true"` for as long as anything is outstanding, and CSS such as `:host([data-lit-pending])`
 * can style it. Assistive technology reads `aria-busy`.
 */
function setPending(host: HTMLElement, actionName: string, pending: boolean): void {
  const names = pendingActions.get(host) ?? [];
  if (pending) {
    names.push(actionName);
  } else {
    const at = names.indexOf(actionName);
    if (at >= 0) names.splice(at, 1);
  }
  pendingActions.set(host, names);

  if (typeof host.setAttribute !== 'function') return;
  if (names.length > 0) {
    host.setAttribute(PENDING_ATTRIBUTE, [...new Set(names)].join(' '));
    host.setAttribute('aria-busy', 'true');
  } else {
    host.removeAttribute?.(PENDING_ATTRIBUTE);
    host.removeAttribute?.('aria-busy');
  }
}

/** Tail of each element's chain of in-flight actions. */
const actionQueues = new WeakMap<object, Promise<unknown>>();

/** Runs one action request to completion: sends the signed snapshot, applies every frame, settles. */
async function performAction<T>(host: ClientElement, actionHash: string, args: unknown[], actionName: string, options: DispatchActionOptions): Promise<T> {
  const seq = (host.__litSeq = (host.__litSeq ?? 0) + 1);

  try {
    const { body, token } = buildRequest(host, seq, args);
    const prefix = options.routePrefix || DEFAULT_ROUTE_PREFIX;
    const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/x-ndjson, application/json' };
    if (token) headers['X-Lit-Action-Token'] = token;

    const response = await fetch(`${prefix.endsWith('/') ? prefix : `${prefix}/`}${actionHash}`, { method: 'POST', headers, body: JSON.stringify(body) });
    if (!response.ok) throw await toActionError(response);

    let result: unknown;
    for await (const frame of readFrames(response)) {
      executePatches(host, frame as PatchFrame);
      if ('e' in frame) throw new ServerActionError(frame.e, frame.code || 'ACTION_FRAME_ERROR', undefined, frame.fields);
      if ('r' in frame) result = frame.r;
    }

    host.actionState?.setSuccess?.(actionName, result);
    announce(host, ACTION_SUCCESS_EVENT, { action: actionName, result });
    return result as T;
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    host.actionState?.setError?.(actionName, error);
    announce(host, ACTION_ERROR_EVENT, { action: actionName, error });
    throw error;
  }
}

/**
 * Calls an `@action()` on the server for a client element, applies the returned patch frames,
 * and resolves with the action's return value.
 *
 * Actions on one element run strictly one after another. Each request carries the signed snapshot the
 * previous response delivered, so two rapid actions never start from the same state and overwrite one
 * another, and a replay guard on the server can treat every snapshot as single-use. A failed action
 * does not block the ones queued behind it.
 */
export function dispatchServerAction<T = unknown>(element: HTMLElement, actionHash: string, args: unknown[] = [], options: DispatchActionOptions = {}): Promise<T> {
  const host = element as ClientElement;
  const actionName = options.actionName || actionHash;

  host.actionState?.setPending?.(actionName);
  setPending(host, actionName, true);

  const previous = actionQueues.get(host) ?? Promise.resolve();
  const run = previous.then(() => performAction<T>(host, actionHash, args, actionName, options)).finally(() => setPending(host, actionName, false));
  // The queue only waits for settlement; the caller still sees this action's own failure.
  actionQueues.set(
    host,
    run.catch(() => {}),
  );
  return run;
}

/** Alias targeted by compiler-generated client stubs. */
export const __litActionRpc = dispatchServerAction;
