import { ServerActionError } from './errors.js';
import { adoptLeadingSsrStyles, executePatches, getLogicalChild } from './executor.js';
import type { ActionRequestBody, PatchFrame } from './types.js';

export { executePatches } from './executor.js';

export interface DispatchActionOptions {
  actionName?: string;
  routePrefix?: string;
}

/**
 * Hydrates el.__litState, el.__litSig, and el.__litToken from DOM attributes
 * on the host element.
 */
export function __litHydrateState(element: HTMLElement): Record<string, unknown> {
  const el = element as any;
  const hasAttrSig = typeof element.getAttribute === 'function' ? element.getAttribute('data-lit-sig') : null;
  if (el.__litState && Object.keys(el.__litState).length > 0 && (!hasAttrSig || el.__litSig)) {
    return el.__litState;
  }
  if (typeof element.getAttribute === 'function') {
    const rawState = element.getAttribute('data-lit-state');
    if (rawState) {
      try {
        el.__litState = JSON.parse(rawState);
      } catch {
        el.__litState = el.__litState || {};
      }
    } else if (!el.__litState) {
      el.__litState = {};
    }
    const sig = element.getAttribute('data-lit-sig');
    if (sig && !el.__litSig) el.__litSig = sig;
    const token = element.getAttribute('data-lit-token');
    if (token && !el.__litToken) el.__litToken = token;
  } else if (!el.__litState) {
    el.__litState = {};
  }
  return el.__litState;
}

/**
 * Dispatches an action RPC call from a client custom element instance to the edge server.
 */
export async function dispatchServerAction<T = unknown>(element: HTMLElement, actionHash: string, args: unknown[] = [], options: DispatchActionOptions = {}): Promise<T> {
  const el = element as any;
  el.__litSeq = (el.__litSeq || 0) + 1;
  const seq = el.__litSeq;
  if (el.__litLastAppliedSeq === undefined) {
    el.__litLastAppliedSeq = 0;
  }
  const actionName = options.actionName || actionHash;
  const routePrefix = options.routePrefix || '/_lit/a/';

  // Update reactive pending state if ActionStateController is present
  if (el.actionState && typeof el.actionState.setPending === 'function') {
    el.actionState.setPending(actionName);
  }

  // Hydrate client state from data-lit-state attribute if not yet populated
  __litHydrateState(element);

  // Echo only the attributes the server signed (listed in data-lit-attrs) plus the build and token
  // identifiers. Unrelated host attributes (class, style, ...) can change freely without invalidating state.
  const attrs: Record<string, string> = {};
  if (typeof element.getAttribute === 'function') {
    const signedNames = (element.getAttribute('data-lit-attrs') || '').split(' ').filter(Boolean);
    for (const name of [...signedNames, 'data-lit-build-id', 'data-lit-token']) {
      const value = element.getAttribute(name);
      if (value !== null) {
        attrs[name] = value;
      }
    }
  }

  // Collect client state snapshot if available
  const state: Record<string, unknown> = el.__litState || {};
  const sig = typeof element.getAttribute === 'function' ? element.getAttribute('data-lit-sig') || el.__litSig || '' : el.__litSig || '';
  const actionToken = typeof element.getAttribute === 'function' ? element.getAttribute('data-lit-token') || el.__litToken || '' : el.__litToken || '';

  const tagName = element.tagName
    ? element.tagName.toLowerCase()
    : (element as any).localName
      ? String((element as any).localName).toLowerCase()
      : (element.constructor as any)?.is
        ? String((element.constructor as any).is).toLowerCase()
        : 'custom-element';

  const payload: ActionRequestBody = {
    tag: tagName,
    attrs,
    state,
    sig,
    args,
    seq,
    snapshotSeq: el.__litSnapshotSeq ?? 0,
  };

  try {
    const url = `${routePrefix.endsWith('/') ? routePrefix : `${routePrefix}/`}${actionHash}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/x-ndjson, application/json',
    };
    if (actionToken) {
      headers['X-Lit-Action-Token'] = actionToken;
    }

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });

    // Guard: drop stale response if a newer request already applied
    if (seq < (el.__litLastAppliedSeq || 0)) {
      return undefined as unknown as T;
    }

    if (!response.ok) {
      const errText = await response.text();
      let errJson: any = null;
      try {
        errJson = JSON.parse(errText);
      } catch {}
      const message = errJson?.message || errJson?.error || errText || `Action request failed with status ${response.status}`;
      throw new ServerActionError(message, errJson?.code || 'ACTION_ERROR', response.status);
    }

    let actionResult: any;
    const processFrame = (frame: PatchFrame) => {
      applyPatchFrame(element, frame);
      el.__litLastAppliedSeq = Math.max(el.__litLastAppliedSeq || 0, seq);
      if ('e' in frame) {
        throw new ServerActionError(frame.e, frame.code || 'ACTION_FRAME_ERROR');
      }
      if ('r' in frame) {
        actionResult = (frame as any).r;
      }
    };

    // Handle response stream or body
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/x-ndjson') && response.body) {
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        // Check sequence before processing chunks in case a newer request settled mid-stream
        if (seq < (el.__litLastAppliedSeq || 0)) {
          await reader.cancel().catch(() => {});
          return undefined as unknown as T;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          if (seq < (el.__litLastAppliedSeq || 0)) {
            await reader.cancel().catch(() => {});
            return undefined as unknown as T;
          }

          processFrame(JSON.parse(trimmed));
        }
      }
      if (buffer.trim()) {
        if (seq < (el.__litLastAppliedSeq || 0)) {
          return undefined as unknown as T;
        }
        processFrame(JSON.parse(buffer.trim()));
      }
    } else {
      const data = await response.json();

      if (seq < (el.__litLastAppliedSeq || 0)) {
        return undefined as unknown as T;
      }

      if (Array.isArray(data)) {
        for (const frame of data) {
          if (seq < (el.__litLastAppliedSeq || 0)) {
            return undefined as unknown as T;
          }
          processFrame(frame);
        }
      } else if (data && typeof data === 'object') {
        if ('e' in data) {
          throw new ServerActionError(data.e, data.code || 'ACTION_ERROR');
        }
        applyPatchFrame(element, data as PatchFrame);
        el.__litLastAppliedSeq = Math.max(el.__litLastAppliedSeq || 0, seq);
        if ('r' in data) {
          actionResult = (data as any).r;
        } else {
          actionResult = data.result !== undefined ? data.result : data;
        }
      }
    }

    // Guard: confirm sequence before advancing applied sequence and invoking callbacks
    if (seq < (el.__litLastAppliedSeq || 0)) {
      return undefined as unknown as T;
    }
    el.__litLastAppliedSeq = Math.max(el.__litLastAppliedSeq || 0, seq);

    if (el.actionState && typeof el.actionState.setSuccess === 'function') {
      el.actionState.setSuccess(actionName, actionResult);
    }
    return actionResult as T;
  } catch (err: any) {
    // Suppress errors and state mutation from stale out-of-order requests
    if (seq < (el.__litLastAppliedSeq || 0)) {
      return undefined as unknown as T;
    }
    const error = err instanceof Error ? err : new Error(String(err));
    if (el.actionState && typeof el.actionState.setError === 'function') {
      el.actionState.setError(actionName, error);
    }
    throw error;
  }
}

/**
 * Alias for generated compiler stubs.
 */
export const __litActionRpc = dispatchServerAction;

/**
 * Applies an action response patch frame to an element instance.
 */
function applyPatchFrame(element: HTMLElement, frame: PatchFrame): void {
  executePatches(element, frame);
}

/**
 * Binds a standard HTML form submission to an action method.
 */
export function bindFormAction(element: HTMLElement, actionFn: (...args: any[]) => Promise<any>): (event: SubmitEvent) => void {
  return (event: SubmitEvent) => {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const formData = new FormData(form);
    const data: Record<string, any> = Object.create(null);
    formData.forEach((value, key) => {
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
        return;
      }
      if (Object.hasOwn(data, key)) {
        if (!Array.isArray(data[key])) {
          data[key] = [data[key]];
        }
        data[key].push(value);
      } else {
        data[key] = value;
      }
    });
    actionFn.call(element, data);
  };
}

export interface EventDescriptor {
  path: number[];
  event: string;
  actionHash: string;
  argExpr?: (el: HTMLElement) => unknown[] | Promise<unknown[]>;
}

const boundNodeEvents = new WeakMap<object, Set<string>>();

/**
 * Binds client DOM events to action RPC calls for zero-Lit stubs.
 */
export function __litBindEvents(element: HTMLElement, rootOrDescriptors: Node | Array<EventDescriptor>, maybeDescriptors?: Array<EventDescriptor>): void {
  __litHydrateState(element);
  const [root, eventDescriptors] = Array.isArray(rootOrDescriptors)
    ? [element.shadowRoot || element, rootOrDescriptors]
    : [(rootOrDescriptors as Node) || element.shadowRoot || element, maybeDescriptors || []];
  adoptLeadingSsrStyles(element, root, eventDescriptors);

  (element as any).__litRebind = () => {
    (element as any).__litState = undefined;
    (element as any).__litSig = undefined;
    (element as any).__litToken = undefined;
    __litBindEvents(element, element.shadowRoot || element, eventDescriptors);
  };

  for (const desc of eventDescriptors) {
    let node: Node | null = root;
    for (const idx of desc.path) {
      if (!node) {
        break;
      }
      node = getLogicalChild(node, idx);
    }
    const canListen = Boolean(
      node &&
        typeof (node as any).addEventListener === 'function' &&
        ((node as any).nodeType === 1 ||
          (node as any).nodeType === 11 ||
          (node as any).nodeType === undefined ||
          (typeof Element !== 'undefined' && node instanceof Element) ||
          (typeof DocumentFragment !== 'undefined' && node instanceof DocumentFragment)),
    );
    if (canListen && node) {
      let registered = boundNodeEvents.get(node);
      if (!registered) {
        registered = new Set();
        boundNodeEvents.set(node, registered);
      }
      const bindKey = `${desc.event}:${desc.actionHash}`;
      if (registered.has(bindKey)) {
        continue;
      }
      registered.add(bindKey);

      if (desc.event === 'click') {
        node.addEventListener('mousedown', (e: any) => {
          const sr = element.shadowRoot;
          if (sr?.activeElement && sr.activeElement !== node && (sr.activeElement.tagName === 'INPUT' || sr.activeElement.tagName === 'TEXTAREA')) {
            e.preventDefault();
          }
        });
      }
      node.addEventListener(desc.event, async (_e) => {
        const args = desc.argExpr ? await desc.argExpr(element) : [];
        dispatchServerAction(element, desc.actionHash, args);
      });
    }
  }
}
