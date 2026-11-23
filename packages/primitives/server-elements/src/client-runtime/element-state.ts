import type { WireState } from '../types.js';

/** Subset of `ActionStateController` the dispatcher drives. */
export interface ActionStateSink {
  setPending(actionName: string): void;
  setSuccess(actionName: string, data: unknown): void;
  setError(actionName: string, error: Error): void;
}

/**
 * Per-element bookkeeping the client keeps between actions: the signed snapshot it must echo,
 * and the counters used to drop out-of-order responses.
 */
export interface ClientElement extends HTMLElement {
  /** Readable state, or an opaque ciphertext string when the server encrypts state. */
  __litState?: WireState;
  __litSig?: string;
  __litToken?: string;
  /** Count of requests issued. Orders responses; not signed. */
  __litSeq?: number;
  /** Sequence number of the signed snapshot held in `__litSig`. */
  __litSnapshotSeq?: number;
  actionState?: ActionStateSink;
}

function attributeOf(element: HTMLElement, name: string): string | null {
  return typeof element.getAttribute === 'function' ? element.getAttribute(name) : null;
}

/**
 * Loads the signed state, signature and token the server rendered onto the host element's
 * attributes. Values already held in memory win, because patches keep them newer than the DOM.
 */
export function hydrateClientState(element: HTMLElement): WireState {
  const host = element as ClientElement;
  const attributeSig = attributeOf(element, 'data-lit-sig');

  if (host.__litState && Object.keys(host.__litState).length > 0 && (!attributeSig || host.__litSig)) {
    return host.__litState;
  }

  const rawState = attributeOf(element, 'data-lit-state');
  if (rawState) {
    try {
      host.__litState = JSON.parse(rawState);
    } catch {
      // Not JSON: the server encrypted the state, so keep the ciphertext as it is.
      host.__litState = rawState;
    }
  } else {
    host.__litState ??= {};
  }

  if (attributeSig && !host.__litSig) host.__litSig = attributeSig;
  const token = attributeOf(element, 'data-lit-token');
  if (token && !host.__litToken) host.__litToken = token;
  return host.__litState as WireState;
}

/** Forgets everything hydrated from the DOM so the next action re-reads the host's attributes. */
export function resetClientState(element: HTMLElement): void {
  const host = element as ClientElement;
  host.__litState = undefined;
  host.__litSig = undefined;
  host.__litToken = undefined;
}

/** Lowercase tag name of a client element, resilient to partially implemented hosts. */
export function tagNameOf(element: HTMLElement): string {
  const named = element.tagName || (element as { localName?: string }).localName || (element.constructor as { is?: string }).is;
  return named ? String(named).toLowerCase() : 'custom-element';
}

/**
 * Attributes echoed to the server: the ones the server signed (listed in `data-lit-attrs`) plus
 * the build and token identifiers. Unrelated host attributes (class, style) can change freely.
 */
export function collectSignedAttributes(element: HTMLElement): Record<string, string> {
  const attrs: Record<string, string> = {};
  const signed = (attributeOf(element, 'data-lit-attrs') || '').split(' ').filter(Boolean);
  for (const name of [...signed, 'data-lit-build-id', 'data-lit-token']) {
    const value = attributeOf(element, name);
    if (value !== null) {
      attrs[name] = value;
    }
  }
  return attrs;
}
