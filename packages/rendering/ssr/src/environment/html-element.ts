import { is as cssIs, selectAll as cssSelectAll, selectOne as cssSelectOne } from 'css-select';
import { ARIA_MIXIN_ENTRIES } from './aria.js';
import type { ValidityStateStub } from './constructable.js';
import { type DocumentStub, defaultDocumentStub } from './document.js';
import type { ReactiveControllerLike } from './events.js';
import { ShadowRootStub, ssrDomAdapter } from './shadow-root.js';
import { EMPTY_ARRAY, EMPTY_LIGHT_CHILDREN, EMPTY_LIGHT_NODES, NOOP_FN, SHARED_VALIDITY_STATE, TRUE_FN } from './shared.js';

export class HTMLElementStub {
  get nodeType(): number {
    return 1;
  }
  tagName: string;
  get localName(): string {
    return this.tagName.toLowerCase();
  }
  shadowRoot: ShadowRootStub | null = null;
  /** Internal shadow root reference retained even when `mode === 'closed'` so `ElementInternals.shadowRoot` works. */
  __shadowRoot: ShadowRootStub | null = null;
  /** Attached `ElementInternals` record created by `attachInternals()`. */
  __internals: Record<string, any> | null = null;
  isConnected: boolean = false;
  /** Parent host reference set by the SSR renderer during tree traversal for composed event bubbling. */
  _ssrParentHost: HTMLElementStub | null = null;
  /** Root context lookup callback set by the SSR renderer when `options.context` is provided. */
  _ssrContextLookup?: (contextKey: unknown) => { found: boolean; value: unknown };
  /** Light-DOM child elements populated by the SSR renderer before lifecycle execution. */
  _ssrLightChildren: HTMLElementStub[] = EMPTY_LIGHT_CHILDREN;
  /** Light-DOM child nodes (elements and text nodes) populated by the SSR renderer before lifecycle execution. */
  _ssrLightChildNodes: any[] = EMPTY_LIGHT_NODES;
  private _attributes: Map<string, string> | null = null;
  private _listeners: Map<string, Set<((event: any) => void) | { handleEvent: (event: any) => void }>> | null = null;
  private _captureListeners: Map<string, Set<((event: any) => void) | { handleEvent: (event: any) => void }>> | null = null;
  private _controllers: Set<ReactiveControllerLike> | null = null;

  constructor(tagName?: string) {
    const ctor = this.constructor as any;
    this.tagName = (tagName || ctor.is || 'custom-element').toUpperCase();
  }

  addController(controller: ReactiveControllerLike): void {
    (this._controllers ??= new Set()).add(controller);
    if (this.isConnected && typeof controller.hostConnected === 'function') {
      controller.hostConnected();
    }
  }

  removeController(controller: ReactiveControllerLike): void {
    this._controllers?.delete(controller);
  }

  /** @internal */
  _invokeControllersHostUpdate(): void {
    if (!this._controllers) return;
    for (const ctrl of this._controllers) {
      if (typeof ctrl.hostUpdate === 'function') {
        ctrl.hostUpdate();
      }
    }
  }

  connectedCallback(): void {
    if (!this._controllers) return;
    for (const ctrl of this._controllers) {
      if (typeof ctrl.hostConnected === 'function') {
        ctrl.hostConnected();
      }
    }
  }

  attachShadow(init: ShadowRootInit = { mode: 'open' }): ShadowRootStub {
    const sr = new ShadowRootStub(this, init);
    this.__shadowRoot = sr;
    this.shadowRoot = init?.mode === 'closed' ? null : sr;
    return sr;
  }

  getAttribute(name: string): string | null {
    return this._attributes ? (this._attributes.get(name.toLowerCase()) ?? null) : null;
  }

  setAttribute(name: string, value: string): void {
    (this._attributes ??= new Map()).set(name.toLowerCase(), String(value));
  }

  hasAttribute(name: string): boolean {
    return this._attributes ? this._attributes.has(name.toLowerCase()) : false;
  }

  removeAttribute(name: string): void {
    this._attributes?.delete(name.toLowerCase());
  }

  toggleAttribute(name: string, force?: boolean): boolean {
    const lower = name.toLowerCase();
    const exists = this._attributes ? this._attributes.has(lower) : false;
    const shouldAdd = force !== undefined ? force : !exists;
    if (shouldAdd) {
      (this._attributes ??= new Map()).set(lower, '');
      return true;
    }
    this._attributes?.delete(lower);
    return false;
  }

  getAttributeNames(): string[] {
    return this._attributes ? Array.from(this._attributes.keys()) : [];
  }

  get attributes(): Array<{ name: string; value: string }> {
    return this._attributes ? Array.from(this._attributes, ([name, value]) => ({ name, value })) : [];
  }

  /** @internal */
  _getRawAttributesMap(): Map<string, string> | null {
    return this._attributes;
  }

  get id(): string {
    return this.getAttribute('id') ?? '';
  }

  set id(val: string) {
    this.setAttribute('id', val);
  }

  get className(): string {
    return this.getAttribute('class') ?? '';
  }

  set className(val: string) {
    this.setAttribute('class', val);
  }

  get slot(): string {
    return this.getAttribute('slot') ?? '';
  }

  set slot(val: string) {
    this.setAttribute('slot', val);
  }

  get role(): string | null {
    return this.getAttribute('role');
  }

  set role(val: string | null) {
    if (val === null) {
      this.removeAttribute('role');
    } else {
      this.setAttribute('role', val);
    }
  }

  addEventListener(type: string, listener: any, options?: any): void {
    if (!listener) return;
    const capture = typeof options === 'boolean' ? options : Boolean(options?.capture);
    const map = capture ? (this._captureListeners ??= new Map()) : (this._listeners ??= new Map());
    let set = map.get(type);
    if (!set) {
      set = new Set();
      map.set(type, set);
    }
    set.add(listener);
  }

  removeEventListener(type: string, listener: any, options?: any): void {
    const capture = typeof options === 'boolean' ? options : Boolean(options?.capture);
    const map = capture ? this._captureListeners : this._listeners;
    const set = map?.get(type);
    if (set) {
      set.delete(listener);
    }
  }

  dispatchEvent(event: any): boolean {
    if (!event || typeof event.type !== 'string') return true;
    const setEventField = (key: string, value: unknown) => {
      try {
        Object.defineProperty(event, key, { value, configurable: true, writable: true, enumerable: true });
      } catch {}
    };
    if (!event.target) {
      setEventField('target', this);
    }
    if (!event._ssrPatchedStop) {
      const origStop = typeof event.stopPropagation === 'function' ? event.stopPropagation.bind(event) : null;
      const origStopImmediate = typeof event.stopImmediatePropagation === 'function' ? event.stopImmediatePropagation.bind(event) : null;
      setEventField('_ssrPatchedStop', true);
      setEventField('stopPropagation', () => {
        event._propagationStopped = true;
        origStop?.();
      });
      setEventField('stopImmediatePropagation', () => {
        event._propagationStopped = true;
        event._immediatePropagationStopped = true;
        origStopImmediate?.();
      });
    }

    const path: HTMLElementStub[] = [];
    let cursor: HTMLElementStub | null = this;
    let rootLookup: ((contextKey: unknown) => { found: boolean; value: unknown }) | undefined = this._ssrContextLookup;
    while (cursor) {
      path.push(cursor);
      if (cursor._ssrContextLookup) {
        rootLookup = cursor._ssrContextLookup;
      }
      cursor = cursor._ssrParentHost;
    }
    const serverRoot = (globalThis as any).litServerRoot;
    if (serverRoot instanceof HTMLElementStub && serverRoot !== this && !path.includes(serverRoot)) {
      path.push(serverRoot);
    }

    for (let idx = path.length - 1; idx >= 0; idx--) {
      const node = path[idx];
      setEventField('currentTarget', node);
      setEventField('eventPhase', node === this ? 2 : 1);
      const captureSet = node._captureListeners?.get(event.type);
      if (captureSet && captureSet.size > 0) {
        for (const listener of Array.from(captureSet)) {
          if (typeof listener === 'function') {
            listener.call(node, event);
          } else if (listener && typeof listener.handleEvent === 'function') {
            listener.handleEvent(event);
          }
          if (event._immediatePropagationStopped) {
            setEventField('currentTarget', null);
            return !event.defaultPrevented;
          }
        }
      }
      if (event._propagationStopped || event.cancelBubble) {
        setEventField('currentTarget', null);
        return !event.defaultPrevented;
      }
    }

    const bubblePath = event.bubbles ? path : [this];
    for (const node of bubblePath) {
      setEventField('currentTarget', node);
      setEventField('eventPhase', node === this ? 2 : 3);
      const bubbleSet = node._listeners?.get(event.type);
      if (bubbleSet && bubbleSet.size > 0) {
        for (const listener of Array.from(bubbleSet)) {
          if (typeof listener === 'function') {
            listener.call(node, event);
          } else if (listener && typeof listener.handleEvent === 'function') {
            listener.handleEvent(event);
          }
          if (event._immediatePropagationStopped) {
            setEventField('currentTarget', null);
            return !event.defaultPrevented;
          }
        }
      }
      if (event._propagationStopped || event.cancelBubble) {
        setEventField('currentTarget', null);
        return !event.defaultPrevented;
      }
    }

    setEventField('currentTarget', null);

    if (event.type === 'context-request' && !event._propagationStopped && !event.cancelBubble && rootLookup && typeof event.callback === 'function') {
      const lookup = rootLookup(event.context);
      if (lookup.found) {
        event.stopPropagation?.();
        event.callback(lookup.value);
      }
    }

    return !event.defaultPrevented;
  }

  get childNodes(): any[] {
    return this._ssrLightChildNodes;
  }

  get children(): HTMLElementStub[] {
    return this._ssrLightChildren;
  }

  get firstChild(): any {
    return this._ssrLightChildNodes[0] ?? null;
  }

  get lastChild(): any {
    return this._ssrLightChildNodes.at(-1) ?? null;
  }

  get firstElementChild(): HTMLElementStub | null {
    return this._ssrLightChildren[0] ?? null;
  }

  get lastElementChild(): HTMLElementStub | null {
    return this._ssrLightChildren.at(-1) ?? null;
  }

  get textContent(): string {
    let out = '';
    for (const node of this._ssrLightChildNodes) {
      if (!node) continue;
      if (node.nodeType === 3) {
        out += node.data ?? node.textContent ?? '';
      } else if (typeof node.textContent === 'string') {
        out += node.textContent;
      }
    }
    return out;
  }

  set textContent(val: string | null) {
    const str = val == null ? '' : String(val);
    this._ssrLightChildren = [];
    this._ssrLightChildNodes = str ? [{ nodeType: 3, data: str, textContent: str }] : [];
  }

  querySelector(selector: string): HTMLElementStub | null {
    if (!selector?.trim() || this._ssrLightChildren.length === 0) return null;
    try {
      return cssSelectOne(selector, this._ssrLightChildren, { adapter: ssrDomAdapter, context: this });
    } catch {
      return null;
    }
  }

  querySelectorAll(selector: string): HTMLElementStub[] {
    if (!selector?.trim() || this._ssrLightChildren.length === 0) return [];
    try {
      return cssSelectAll(selector, this._ssrLightChildren, { adapter: ssrDomAdapter, context: this });
    } catch {
      return [];
    }
  }

  matches(selector: string): boolean {
    if (!selector?.trim()) return false;
    try {
      return cssIs(this, selector, { adapter: ssrDomAdapter });
    } catch {
      return false;
    }
  }

  closest(selector: string): HTMLElementStub | null {
    if (!selector?.trim()) return null;
    let curr: HTMLElementStub | null = this;
    while (curr) {
      if (curr.matches(selector)) return curr;
      curr = curr._ssrParentHost;
    }
    return null;
  }

  contains(node: any): boolean {
    if (node === this) return true;
    for (const child of this._ssrLightChildNodes) {
      if (child === node) return true;
      if (child && typeof child.contains === 'function' && child.contains(node)) {
        return true;
      }
    }
    return false;
  }

  getRootNode(_options?: any): any {
    return this;
  }

  get ownerDocument(): DocumentStub {
    return defaultDocumentStub;
  }

  attachInternals(): {
    readonly shadowRoot: ShadowRootStub | null;
    form: null;
    willValidate: boolean;
    validity: ValidityStateStub;
    validationMessage: string;
    setFormValue: (value: any) => void;
    setValidity: (flags?: any, message?: string) => void;
    checkValidity: () => boolean;
    reportValidity: () => boolean;
    labels: any[];
    states: Set<string>;
    role: string | null;
    ariaLabel: string | null;
    ariaDescription: string | null;
    [key: string]: any;
  } {
    if (this.__internals) {
      throw new Error('Failed to execute attachInternals: ElementInternals for the specified element was already attached.');
    }
    const host = this;
    let lazyStates: Set<string> | null = null;
    const internals: Record<string, any> = {
      get shadowRoot() {
        return host.__shadowRoot ?? host.shadowRoot;
      },
      form: null,
      willValidate: true,
      validity: SHARED_VALIDITY_STATE,
      validationMessage: '',
      setFormValue: NOOP_FN,
      setValidity: NOOP_FN,
      checkValidity: TRUE_FN,
      reportValidity: TRUE_FN,
      labels: EMPTY_ARRAY,
      get states() {
        return (lazyStates ??= new Set<string>());
      },
      role: null,
      ariaLabel: null,
      ariaDescription: null,
    };
    for (let i = 0; i < ARIA_MIXIN_ENTRIES.length; i++) {
      internals[ARIA_MIXIN_ENTRIES[i][0]] = null;
    }
    this.__internals = internals;
    return internals as any;
  }
}
