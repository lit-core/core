/**
 * Pure V8 Isolate Minimal Environment (ISME) for @lit-core/ssr.
 * Stateless stubs for HTMLElement, customElements, CustomEvent, and CSSStyleSheet
 * with no dependency on node:vm. createIsolateEnvironment() returns the stubs without
 * touching globals; installIsolateGlobals() only fills globals that are still undefined
 * (including window, aliased to globalThis) and never replaces existing ones.
 */

export interface CustomElementRegistryLike {
  get(name: string): (new () => any) | undefined;
  define(name: string, ctor: new () => any): void;
  has?(name: string): boolean;
  getRegisteredTagNames?(): Iterable<string>;
}

export class CustomEventStub<T = unknown> {
  readonly type: string;
  readonly detail: T | null;
  readonly bubbles: boolean;
  readonly cancelable: boolean;
  readonly composed: boolean;
  defaultPrevented = false;
  /** @internal */
  _propagationStopped = false;
  /** @internal */
  _immediatePropagationStopped = false;
  target: any = null;
  currentTarget: any = null;

  constructor(type: string, eventInitDict?: CustomEventInit<T>) {
    this.type = type;
    this.detail = (eventInitDict?.detail as T) ?? null;
    this.bubbles = eventInitDict?.bubbles ?? false;
    this.cancelable = eventInitDict?.cancelable ?? false;
    this.composed = eventInitDict?.composed ?? false;
  }

  preventDefault(): void {
    if (this.cancelable) {
      this.defaultPrevented = true;
    }
  }

  stopPropagation(): void {
    this._propagationStopped = true;
  }

  stopImmediatePropagation(): void {
    this._propagationStopped = true;
    this._immediatePropagationStopped = true;
  }
}

/**
 * W3C Web Components Community Group Context key type.
 */
export type Context<KeyType = unknown, ValueType = unknown> = KeyType & {
  readonly __context__?: ValueType;
};

/**
 * Create a typed context key per the W3C Web Components Community Group Context protocol.
 */
export function createContext<ValueType, KeyType = unknown>(key: KeyType): Context<KeyType, ValueType>;
export function createContext<ValueType, KeyType = unknown>(key: KeyType): Context<KeyType, ValueType> {
  return key as Context<KeyType, ValueType>;
}

export type ContextCallback<ValueType> = (value: ValueType, unsubscribe?: () => void) => void;

/**
 * Standard W3C `context-request` event.
 */
export class ContextRequestEvent<T extends Context<unknown, unknown> = Context<unknown, unknown>> extends CustomEventStub<null> {
  readonly context: T;
  readonly callback: ContextCallback<T extends Context<unknown, infer V> ? V : unknown>;
  readonly subscribe?: boolean;

  constructor(context: T, callback: ContextCallback<T extends Context<unknown, infer V> ? V : unknown>, subscribe?: boolean) {
    super('context-request', { bubbles: true, cancelable: true, composed: true });
    this.context = context;
    this.callback = callback;
    this.subscribe = subscribe;
  }
}

export interface ReactiveControllerLike {
  hostConnected?(): void;
  hostDisconnected?(): void;
  hostUpdate?(): void;
  hostUpdated?(): void;
}

export class ValidityStateStub {
  get badInput(): boolean {
    return false;
  }
  get customError(): boolean {
    return false;
  }
  get patternMismatch(): boolean {
    return false;
  }
  get rangeOverflow(): boolean {
    return false;
  }
  get rangeUnderflow(): boolean {
    return false;
  }
  get stepMismatch(): boolean {
    return false;
  }
  get tooLong(): boolean {
    return false;
  }
  get tooShort(): boolean {
    return false;
  }
  get typeMismatch(): boolean {
    return false;
  }
  get valid(): boolean {
    return true;
  }
  get valueMissing(): boolean {
    return false;
  }
}

export class CSSStyleSheetStub {
  cssRules: string[] = [];

  replaceSync(cssText: string): void {
    this.cssRules = [cssText];
  }

  async replace(cssText: string): Promise<CSSStyleSheetStub> {
    this.cssRules = [cssText];
    return this;
  }
}

const SHARED_VALIDITY_STATE = Object.freeze(new ValidityStateStub()) as ValidityStateStub;
const EMPTY_STYLE_SHEETS: CSSStyleSheetStub[] = Object.freeze([]) as unknown as CSSStyleSheetStub[];
const EMPTY_ARRAY: any[] = Object.freeze([]) as unknown as any[];
const NOOP_FN = () => {};
const TRUE_FN = () => true;

export class ShadowRootStub {
  readonly host: HTMLElementStub;
  readonly mode: ShadowRootMode;
  readonly delegatesFocus: boolean;
  private _adoptedStyleSheets: CSSStyleSheetStub[] = EMPTY_STYLE_SHEETS;
  private _childNodes: any[] | null = null;
  private _children: any[] | null = null;
  activeElement: any = null;
  innerHTML = '';

  constructor(host: HTMLElementStub, init: ShadowRootInit = { mode: 'open' }) {
    this.host = host;
    this.mode = init.mode;
    this.delegatesFocus = init.delegatesFocus ?? false;
  }

  get childNodes(): any[] {
    return (this._childNodes ??= []);
  }

  set childNodes(nodes: any[]) {
    this._childNodes = nodes;
  }

  get children(): any[] {
    return (this._children ??= []);
  }

  set children(nodes: any[]) {
    this._children = nodes;
  }

  get adoptedStyleSheets(): CSSStyleSheetStub[] {
    return this._adoptedStyleSheets;
  }

  set adoptedStyleSheets(sheets: CSSStyleSheetStub[]) {
    this._adoptedStyleSheets = sheets;
  }

  appendChild<T>(node: T): T {
    (this._childNodes ??= []).push(node);
    return node;
  }

  removeChild<T>(node: T): T {
    return node;
  }

  insertBefore<T>(node: T, _ref?: any): T {
    (this._childNodes ??= []).push(node);
    return node;
  }

  append(...nodes: any[]): void {
    (this._childNodes ??= []).push(...nodes);
  }

  prepend(...nodes: any[]): void {
    (this._childNodes ??= []).unshift(...nodes);
  }

  querySelector(_selector: string): any {
    return null;
  }

  querySelectorAll(_selector: string): any[] {
    return [];
  }

  getElementById(_id: string): any {
    return null;
  }

  addEventListener(_type: string, _listener: any, _options?: any): void {}
  removeEventListener(_type: string, _listener: any, _options?: any): void {}
  dispatchEvent(_event: any): boolean {
    return true;
  }
}

function matchesSimpleSelector(el: HTMLElementStub, selector: string): boolean {
  const trimmed = selector.trim();
  if (!trimmed) return false;
  if (trimmed === '*') return true;
  if (trimmed.startsWith('#')) {
    return el.getAttribute('id') === trimmed.slice(1);
  }
  if (trimmed.startsWith('.')) {
    const cls = trimmed.slice(1);
    const attr = el.getAttribute('class') || '';
    return attr.split(/\s+/).includes(cls);
  }
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    const inner = trimmed.slice(1, -1).trim();
    const eqIdx = inner.indexOf('=');
    if (eqIdx === -1) {
      return el.hasAttribute(inner);
    }
    const attrName = inner.slice(0, eqIdx).trim();
    let expected = inner.slice(eqIdx + 1).trim();
    if ((expected.startsWith('"') && expected.endsWith('"')) || (expected.startsWith("'") && expected.endsWith("'"))) {
      expected = expected.slice(1, -1);
    }
    return el.getAttribute(attrName) === expected;
  }
  return el.tagName.toLowerCase() === trimmed.toLowerCase();
}

export const HYDRATE_INTERNALS_ATTR_PREFIX = 'hydrate-internals-';

export const ARIA_MIXIN_ATTRIBUTES: Readonly<Record<string, string>> = Object.freeze({
  ariaAtomic: 'aria-atomic',
  ariaAutoComplete: 'aria-autocomplete',
  ariaBrailleLabel: 'aria-braillelabel',
  ariaBrailleRoleDescription: 'aria-brailleroledescription',
  ariaBusy: 'aria-busy',
  ariaChecked: 'aria-checked',
  ariaColCount: 'aria-colcount',
  ariaColIndex: 'aria-colindex',
  ariaColIndexText: 'aria-colindextext',
  ariaColSpan: 'aria-colspan',
  ariaCurrent: 'aria-current',
  ariaDescription: 'aria-description',
  ariaDisabled: 'aria-disabled',
  ariaExpanded: 'aria-expanded',
  ariaHasPopup: 'aria-haspopup',
  ariaHidden: 'aria-hidden',
  ariaInvalid: 'aria-invalid',
  ariaKeyShortcuts: 'aria-keyshortcuts',
  ariaLabel: 'aria-label',
  ariaLevel: 'aria-level',
  ariaLive: 'aria-live',
  ariaModal: 'aria-modal',
  ariaMultiLine: 'aria-multiline',
  ariaMultiSelectable: 'aria-multiselectable',
  ariaOrientation: 'aria-orientation',
  ariaPlaceholder: 'aria-placeholder',
  ariaPosInSet: 'aria-posinset',
  ariaPressed: 'aria-pressed',
  ariaReadOnly: 'aria-readonly',
  ariaRelevant: 'aria-relevant',
  ariaRequired: 'aria-required',
  ariaRoleDescription: 'aria-roledescription',
  ariaRowCount: 'aria-rowcount',
  ariaRowIndex: 'aria-rowindex',
  ariaRowIndexText: 'aria-rowindextext',
  ariaRowSpan: 'aria-rowspan',
  ariaSelected: 'aria-selected',
  ariaSetSize: 'aria-setsize',
  ariaSort: 'aria-sort',
  ariaValueMax: 'aria-valuemax',
  ariaValueMin: 'aria-valuemin',
  ariaValueNow: 'aria-valuenow',
  ariaValueText: 'aria-valuetext',
  role: 'role',
});

export const ARIA_MIXIN_ENTRIES: ReadonlyArray<readonly [string, string]> = Object.freeze(Object.entries(ARIA_MIXIN_ATTRIBUTES));

const EMPTY_LIGHT_CHILDREN: HTMLElementStub[] = Object.freeze([]) as unknown as HTMLElementStub[];
const EMPTY_LIGHT_NODES: any[] = Object.freeze([]) as unknown as any[];

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
    const found = this.querySelectorAll(selector);
    return found[0] ?? null;
  }

  querySelectorAll(selector: string): HTMLElementStub[] {
    const results: HTMLElementStub[] = [];
    const groups = selector.split(',');
    const walk = (nodes: HTMLElementStub[]) => {
      for (const child of nodes) {
        if (groups.some((g) => matchesSimpleSelector(child, g))) {
          results.push(child);
        }
        if (child._ssrLightChildren.length > 0) {
          walk(child._ssrLightChildren);
        }
      }
    };
    walk(this._ssrLightChildren);
    return results;
  }

  closest(_selector: string): null {
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

export class IsolateCustomElementRegistry implements CustomElementRegistryLike {
  private _definitions = new Map<string, new () => any>();
  private _parent?: CustomElementRegistryLike;

  constructor(parent?: CustomElementRegistryLike) {
    this._parent = parent;
  }

  define(name: string, ctor: new () => any): void {
    const lower = name.toLowerCase();
    if (this._definitions.has(lower)) {
      throw new Error(`Custom element '${name}' is already defined`);
    }
    (ctor as any).is = lower;
    this._definitions.set(lower, ctor);
  }

  get(name: string): (new () => any) | undefined {
    const lower = name.toLowerCase();
    return this._definitions.get(lower) ?? this._parent?.get(lower);
  }

  has(name: string): boolean {
    const lower = name.toLowerCase();
    return this._definitions.has(lower) || (this._parent ? Boolean(this._parent.get(lower)) : false);
  }

  getRegisteredTagNames(): string[] {
    const names = new Set<string>(this._definitions.keys());
    if (typeof this._parent?.getRegisteredTagNames === 'function') {
      for (const name of this._parent.getRegisteredTagNames()) {
        names.add(name.toLowerCase());
      }
    }
    return Array.from(names);
  }
}

export class DocumentStub {
  readonly isServer = true;
  readonly defaultView: typeof globalThis = typeof globalThis !== 'undefined' ? globalThis : (undefined as any);
  readonly body: HTMLElementStub;
  readonly head: HTMLElementStub;
  readonly documentElement: HTMLElementStub;
  readonly activeElement: HTMLElementStub | null = null;
  readonly readyState = 'complete';
  dir = '';
  private _adoptedStyleSheets: CSSStyleSheetStub[] = [];

  constructor() {
    this.body = new HTMLElementStub('BODY');
    this.head = new HTMLElementStub('HEAD');
    this.documentElement = new HTMLElementStub('HTML');
  }

  get adoptedStyleSheets(): CSSStyleSheetStub[] {
    return this._adoptedStyleSheets;
  }

  set adoptedStyleSheets(sheets: CSSStyleSheetStub[]) {
    this._adoptedStyleSheets = sheets;
  }

  createElement(tagName: string): HTMLElementStub {
    return new HTMLElementStub(tagName);
  }

  createDocumentFragment(): HTMLElementStub {
    return new HTMLElementStub('#document-fragment');
  }

  addEventListener(_type: string, _listener: any, _options?: any): void {}
  removeEventListener(_type: string, _listener: any, _options?: any): void {}
  querySelectorAll(_selector: string): any[] {
    return [];
  }
  querySelector(_selector: string): any {
    return null;
  }
  getElementById(_id: string): any {
    return null;
  }
  createTreeWalker(root: any, _whatToShow?: number): any {
    return {
      currentNode: root,
      nextNode: () => null,
    };
  }
  createComment(data?: string): any {
    return {
      nodeType: 8,
      data: data ?? '',
      textContent: data ?? '',
    };
  }
  createTextNode(data?: string): any {
    return {
      nodeType: 3,
      data: data ?? '',
      textContent: data ?? '',
    };
  }
  importNode(node: any, _deep?: boolean): any {
    return node;
  }
}

export const defaultDocumentStub = new DocumentStub();

export interface KeyboardEventInitLike {
  key?: string;
  code?: string;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  bubbles?: boolean;
  cancelable?: boolean;
  composed?: boolean;
}

export class KeyboardEventStub {
  readonly type: string;
  readonly key: string;
  readonly code: string;
  readonly altKey: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
  readonly bubbles: boolean;
  readonly cancelable: boolean;
  readonly composed: boolean;
  defaultPrevented = false;

  constructor(type: string, init?: KeyboardEventInitLike) {
    this.type = type;
    this.key = init?.key ?? '';
    this.code = init?.code ?? '';
    this.altKey = init?.altKey ?? false;
    this.ctrlKey = init?.ctrlKey ?? false;
    this.metaKey = init?.metaKey ?? false;
    this.shiftKey = init?.shiftKey ?? false;
    this.bubbles = init?.bubbles ?? false;
    this.cancelable = init?.cancelable ?? false;
    this.composed = init?.composed ?? false;
  }

  preventDefault(): void {
    if (this.cancelable) {
      this.defaultPrevented = true;
    }
  }

  stopPropagation(): void {}

  stopImmediatePropagation(): void {}
}

export class MutationObserverStub {
  observe(_target?: any, _options?: any): void {}
  disconnect(): void {}
  takeRecords(): any[] {
    return [];
  }
}

export class ResizeObserverStub {
  observe(_target?: any, _options?: any): void {}
  unobserve(_target?: any): void {}
  disconnect(): void {}
}

export class IntersectionObserverStub {
  observe(_target?: any): void {}
  unobserve(_target?: any): void {}
  disconnect(): void {}
  takeRecords(): any[] {
    return [];
  }
}

export interface IsolateEnvironment {
  customElements: IsolateCustomElementRegistry;
  HTMLElement: typeof HTMLElementStub;
  CustomEvent: typeof CustomEventStub;
  CSSStyleSheet: typeof CSSStyleSheetStub;
  KeyboardEvent: typeof KeyboardEventStub;
  MutationObserver: typeof MutationObserverStub;
  ResizeObserver: typeof ResizeObserverStub;
  IntersectionObserver: typeof IntersectionObserverStub;
  document: DocumentStub;
  Document: typeof DocumentStub;
}

export function createIsolateEnvironment(parentRegistry?: CustomElementRegistryLike): IsolateEnvironment {
  return {
    customElements: new IsolateCustomElementRegistry(parentRegistry),
    HTMLElement: HTMLElementStub,
    CustomEvent: CustomEventStub,
    CSSStyleSheet: CSSStyleSheetStub,
    KeyboardEvent: KeyboardEventStub,
    MutationObserver: MutationObserverStub,
    ResizeObserver: ResizeObserverStub,
    IntersectionObserver: IntersectionObserverStub,
    document: defaultDocumentStub,
    Document: DocumentStub,
  };
}

export function installIsolateGlobals(env?: Partial<IsolateEnvironment>): void {
  const g = globalThis as any;
  if (typeof g.HTMLElement === 'undefined') {
    g.HTMLElement = env?.HTMLElement ?? HTMLElementStub;
  }
  if (typeof g.CustomEvent === 'undefined') {
    g.CustomEvent = env?.CustomEvent ?? CustomEventStub;
  }
  if (typeof g.CSSStyleSheet === 'undefined') {
    g.CSSStyleSheet = env?.CSSStyleSheet ?? CSSStyleSheetStub;
  }
  if (typeof g.CSS === 'undefined') {
    g.CSS = {
      supports: () => false,
      escape: (s: string) => String(s),
    };
  }
  if (typeof g.customElements === 'undefined') {
    g.customElements = env?.customElements ?? new IsolateCustomElementRegistry();
  }
  if (typeof g.KeyboardEvent === 'undefined') {
    g.KeyboardEvent = env?.KeyboardEvent ?? KeyboardEventStub;
  }
  if (typeof g.MutationObserver === 'undefined') {
    g.MutationObserver = env?.MutationObserver ?? MutationObserverStub;
  }
  if (typeof g.ResizeObserver === 'undefined') {
    g.ResizeObserver = env?.ResizeObserver ?? ResizeObserverStub;
  }
  if (typeof g.IntersectionObserver === 'undefined') {
    g.IntersectionObserver = env?.IntersectionObserver ?? IntersectionObserverStub;
  }
  if (typeof g.Document === 'undefined') {
    g.Document = env?.Document ?? DocumentStub;
  }
  if (typeof g.ShadowRoot === 'undefined') {
    g.ShadowRoot = ShadowRootStub;
  }
  if (typeof g.Element === 'undefined') {
    g.Element = env?.HTMLElement ?? HTMLElementStub;
  }
  if (typeof g.DocumentFragment === 'undefined') {
    g.DocumentFragment = env?.HTMLElement ?? HTMLElementStub;
  }
  if (typeof g.window === 'undefined') {
    g.window = g;
  }
  if (typeof g.Node === 'undefined') {
    g.Node = env?.HTMLElement ?? HTMLElementStub;
  }
  if (typeof g.litServerRoot === 'undefined') {
    const RootCtor = env?.HTMLElement ?? HTMLElementStub;
    g.litServerRoot = new RootCtor('lit-server-root');
  }
  if (typeof g.Event === 'undefined') {
    g.Event = env?.CustomEvent ?? CustomEventStub;
  }
  if (typeof g.UIEvent === 'undefined') {
    g.UIEvent = env?.CustomEvent ?? CustomEventStub;
  }
  if (typeof g.MouseEvent === 'undefined') {
    g.MouseEvent = env?.CustomEvent ?? CustomEventStub;
  }
  if (typeof g.FocusEvent === 'undefined') {
    g.FocusEvent = env?.CustomEvent ?? CustomEventStub;
  }
  if (typeof g.PointerEvent === 'undefined') {
    g.PointerEvent = env?.CustomEvent ?? CustomEventStub;
  }
  if (typeof g.matchMedia === 'undefined') {
    g.matchMedia = (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    });
  }
  if (typeof g.getComputedStyle === 'undefined') {
    g.getComputedStyle = () => ({
      getPropertyValue: () => '',
    });
  }
  if (typeof g.requestAnimationFrame === 'undefined') {
    g.requestAnimationFrame = () => 0;
  }
  if (typeof g.cancelAnimationFrame === 'undefined') {
    g.cancelAnimationFrame = () => {};
  }
  if (g.window && typeof g.window.dispatchEvent === 'undefined') {
    g.window.dispatchEvent = () => true;
  }
  if (g.window && typeof g.window.addEventListener === 'undefined') {
    g.window.addEventListener = () => {};
  }
  if (g.window && typeof g.window.removeEventListener === 'undefined') {
    g.window.removeEventListener = () => {};
  }
}

/**
 * Execute a synchronous or asynchronous callback with SSR isolate globals installed,
 * restoring `globalThis` afterwards so no newly added keys leak into the host process.
 */
export function withScopedIsolateGlobals<T>(fn: (env: IsolateEnvironment) => T, env?: Partial<IsolateEnvironment>): T {
  const g = globalThis as any;
  const beforeGlobalKeys = new Set<PropertyKey>(Reflect.ownKeys(g));
  const existingWindow = g.window && typeof g.window === 'object' && g.window !== g ? g.window : null;
  const beforeWindowKeys = existingWindow ? new Set<PropertyKey>(Reflect.ownKeys(existingWindow)) : null;

  const restore = () => {
    for (const key of Reflect.ownKeys(g)) {
      if (!beforeGlobalKeys.has(key)) {
        try {
          delete g[key];
        } catch {}
      }
    }
    if (existingWindow && beforeWindowKeys) {
      for (const key of Reflect.ownKeys(existingWindow)) {
        if (!beforeWindowKeys.has(key)) {
          try {
            delete existingWindow[key];
          } catch {}
        }
      }
    }
  };

  const resolvedEnv: IsolateEnvironment = {
    ...createIsolateEnvironment(),
    ...env,
  };
  installIsolateGlobals(resolvedEnv);
  let isAsync = false;
  try {
    const result = fn(resolvedEnv);
    if (result !== null && (typeof result === 'object' || typeof result === 'function') && typeof (result as any).then === 'function') {
      isAsync = true;
      return (result as unknown as Promise<unknown>).finally(restore) as unknown as T;
    }
    return result;
  } finally {
    if (!isAsync) {
      restore();
    }
  }
}
