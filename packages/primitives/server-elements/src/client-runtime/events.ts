import { createFieldCollector } from '../form-fields.js';
import { ACTION_HASH_PATTERN, FORM_FIELD_PREFIX } from '../protocol.js';
import { dispatchServerAction } from './dispatch.js';
import { type ClientElement, hydrateClientState, resetClientState } from './element-state.js';
import { getLogicalChild } from './markers.js';
import { adoptLeadingSsrStyles } from './styles.js';

export interface EventDescriptor {
  /** Logical child-index path from the binding root to the event target. */
  path: number[];
  event: string;
  actionHash: string;
  /** Computes the action arguments at event time. */
  argExpr?: (el: HTMLElement) => unknown[] | Promise<unknown[]>;
}

const ELEMENT_NODE = 1;
const DOCUMENT_FRAGMENT_NODE = 11;

/** Bound `event:actionHash` pairs per node, so rebinding after a rehydrate never double-fires. */
const boundEvents = new WeakMap<object, Set<string>>();

/** Converts submitted form fields into an argument object, collecting repeated names into arrays. */
export function formDataToObject(formData: FormData): Record<string, unknown> {
  const fields = createFieldCollector();
  formData.forEach((value, key) => {
    // The signed snapshot fields exist for no-JavaScript posts; this transport already holds that state.
    if (!key.startsWith(FORM_FIELD_PREFIX)) fields.add(key, value);
  });
  return fields.result;
}

/** Roots whose `submit` events are already routed to actions, so rebinding never double-submits. */
const enhancedRoots = new WeakSet<object>();

/** The action a form posts to, read from its own `action` URL, or `null` for any other form. */
function actionTargetOf(form: HTMLFormElement): { hash: string; routePrefix: string } | null {
  if ((form.getAttribute?.('method') ?? '').toLowerCase() !== 'post') return null;
  const action = form.getAttribute('action');
  if (!action) return null;
  const path = new URL(action, (globalThis as { document?: Document }).document?.baseURI ?? 'http://localhost/').pathname;
  const slash = path.replace(/\/$/, '').lastIndexOf('/');
  const hash = path.replace(/\/$/, '').slice(slash + 1);
  return ACTION_HASH_PATTERN.test(hash) ? { hash, routePrefix: path.slice(0, slash + 1) } : null;
}

/**
 * Turns submits of forms that post to an action into in-place action calls.
 *
 * Without script such a form does a full page post (see `ServerElement.formFields()`). With script the
 * same form calls the action over `fetch` and applies patches, so the page keeps its focus, scroll and
 * unsubmitted input. One delegated listener per root covers forms that appear or change later.
 */
function enhanceActionForms(element: HTMLElement, root: Node): void {
  if (typeof root.addEventListener !== 'function' || enhancedRoots.has(root)) return;
  enhancedRoots.add(root);

  root.addEventListener('submit', (event) => {
    const form = event.target as HTMLFormElement | null;
    const target = form && actionTargetOf(form);
    if (!form || !target) return;

    event.preventDefault();
    const submitter = (event as SubmitEvent).submitter;
    dispatchServerAction(element, target.hash, [formDataToObject(new FormData(form, submitter))], { routePrefix: target.routePrefix }).catch(() => {
      // The error is already surfaced through the element's action state.
    });
  });
}

/** Binds a standard HTML form submission to an action method. */
export function bindFormAction(element: HTMLElement, actionFn: (...args: any[]) => Promise<unknown>): (event: SubmitEvent) => void {
  return (event: SubmitEvent) => {
    event.preventDefault();
    actionFn.call(element, formDataToObject(new FormData(event.currentTarget as HTMLFormElement)));
  };
}

function isListenable(node: Node | null): node is Node {
  return Boolean(node && typeof node.addEventListener === 'function' && (node.nodeType === undefined || node.nodeType === ELEMENT_NODE || node.nodeType === DOCUMENT_FRAGMENT_NODE));
}

/**
 * Pressing a button must not blur a focused text field before the click lands, or the action
 * would run against a stale field value. Cancelling mousedown keeps focus where it is.
 */
function preserveTextFocusOnPress(host: HTMLElement, target: Node): void {
  target.addEventListener('mousedown', (event) => {
    const active = host.shadowRoot?.activeElement;
    if (active && active !== target && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) {
      event.preventDefault();
    }
  });
}

/** Binds client DOM events to action RPC calls for zero-Lit stubs. */
export function __litBindEvents(element: HTMLElement, rootOrDescriptors: Node | EventDescriptor[], maybeDescriptors?: EventDescriptor[]): void {
  hydrateClientState(element);
  const [root, descriptors] = Array.isArray(rootOrDescriptors) ? [element.shadowRoot || element, rootOrDescriptors] : [rootOrDescriptors || element.shadowRoot || element, maybeDescriptors || []];
  adoptLeadingSsrStyles(element, root, descriptors);

  enhanceActionForms(element, root);

  (element as ClientElement & { __litRebind?: () => void }).__litRebind = () => {
    resetClientState(element);
    __litBindEvents(element, element.shadowRoot || element, descriptors);
  };

  for (const descriptor of descriptors) {
    let target: Node | null = root;
    for (const index of descriptor.path) {
      if (!target) break;
      target = getLogicalChild(target, index);
    }
    if (!isListenable(target)) continue;

    let bound = boundEvents.get(target);
    if (!bound) {
      bound = new Set();
      boundEvents.set(target, bound);
    }
    const bindKey = `${descriptor.event}:${descriptor.actionHash}`;
    if (bound.has(bindKey)) continue;
    bound.add(bindKey);

    if (descriptor.event === 'click') {
      preserveTextFocusOnPress(element, target);
    }
    target.addEventListener(descriptor.event, async () => {
      const args = descriptor.argExpr ? await descriptor.argExpr(element) : [];
      dispatchServerAction(element, descriptor.actionHash, args);
    });
  }
}
