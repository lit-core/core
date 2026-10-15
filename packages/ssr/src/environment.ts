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
}

export class CustomEventStub<T = unknown> {
  readonly type: string;
  readonly detail: T | null;
  readonly bubbles: boolean;
  readonly cancelable: boolean;
  readonly composed: boolean;
  defaultPrevented = false;

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

  stopPropagation(): void {}

  stopImmediatePropagation(): void {}
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

export class ShadowRootStub {
  readonly host: HTMLElementStub;
  readonly mode: ShadowRootMode;
  readonly delegatesFocus: boolean;
  adoptedStyleSheets: CSSStyleSheetStub[] = [];

  constructor(host: HTMLElementStub, init: ShadowRootInit = { mode: 'open' }) {
    this.host = host;
    this.mode = init.mode;
    this.delegatesFocus = init.delegatesFocus ?? false;
  }
}

export class HTMLElementStub {
  tagName: string;
  shadowRoot: ShadowRootStub | null = null;
  isConnected: boolean = false;
  private _attributes: Map<string, string> = new Map();

  constructor(tagName?: string) {
    const ctor = this.constructor as any;
    this.tagName = (tagName || ctor.is || 'custom-element').toUpperCase();
  }

  attachShadow(init: ShadowRootInit): ShadowRootStub {
    this.shadowRoot = new ShadowRootStub(this, init);
    return this.shadowRoot;
  }

  getAttribute(name: string): string | null {
    return this._attributes.get(name.toLowerCase()) ?? null;
  }

  setAttribute(name: string, value: string): void {
    this._attributes.set(name.toLowerCase(), String(value));
  }

  hasAttribute(name: string): boolean {
    return this._attributes.has(name.toLowerCase());
  }

  removeAttribute(name: string): void {
    this._attributes.delete(name.toLowerCase());
  }

  toggleAttribute(name: string, force?: boolean): boolean {
    const lower = name.toLowerCase();
    const exists = this._attributes.has(lower);
    const shouldAdd = force !== undefined ? force : !exists;
    if (shouldAdd) {
      this._attributes.set(lower, '');
      return true;
    }
    this._attributes.delete(lower);
    return false;
  }

  getAttributeNames(): string[] {
    return Array.from(this._attributes.keys());
  }

  addEventListener(_type: string, _listener: any, _options?: any): void {}

  removeEventListener(_type: string, _listener: any, _options?: any): void {}

  dispatchEvent(_event: any): boolean {
    return true;
  }

  get childNodes(): any[] {
    return [];
  }

  get children(): any[] {
    return [];
  }

  querySelector(_selector: string): null {
    return null;
  }

  querySelectorAll(_selector: string): any[] {
    return [];
  }

  closest(_selector: string): null {
    return null;
  }

  contains(_node: any): boolean {
    return false;
  }

  getRootNode(_options?: any): any {
    return this;
  }

  get ownerDocument(): DocumentStub {
    return defaultDocumentStub;
  }

  attachInternals(): {
    shadowRoot: ShadowRootStub | null;
    setFormValue: (value: any) => void;
    setValidity: (flags?: any, message?: string) => void;
    checkValidity: () => boolean;
    reportValidity: () => boolean;
    labels: any[];
    states: Set<string>;
    role: string | null;
    ariaLabel: string | null;
    ariaDescription: string | null;
  } {
    return {
      shadowRoot: this.shadowRoot,
      setFormValue: () => {},
      setValidity: () => {},
      checkValidity: () => true,
      reportValidity: () => true,
      labels: [],
      states: new Set<string>(),
      role: null,
      ariaLabel: null,
      ariaDescription: null,
    };
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
}

export class DocumentStub {
  readonly defaultView: typeof globalThis = typeof globalThis !== 'undefined' ? globalThis : (undefined as any);
  readonly body: HTMLElementStub;
  readonly head: HTMLElementStub;
  readonly documentElement: HTMLElementStub;
  readonly activeElement: HTMLElementStub | null = null;

  constructor() {
    this.body = new HTMLElementStub('BODY');
    this.head = new HTMLElementStub('HEAD');
    this.documentElement = new HTMLElementStub('HTML');
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
    };
  }
  createTextNode(data?: string): any {
    return {
      nodeType: 3,
      data: data ?? '',
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

export function createIsolateEnvironment(parentRegistry?: CustomElementRegistryLike): {
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
} {
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

export function installIsolateGlobals(): void {
  const g = globalThis as any;
  if (typeof g.HTMLElement === 'undefined') {
    g.HTMLElement = HTMLElementStub;
  }
  if (typeof g.CustomEvent === 'undefined') {
    g.CustomEvent = CustomEventStub;
  }
  if (typeof g.CSSStyleSheet === 'undefined') {
    g.CSSStyleSheet = CSSStyleSheetStub;
  }
  if (typeof g.customElements === 'undefined') {
    g.customElements = new IsolateCustomElementRegistry();
  }
  if (typeof g.KeyboardEvent === 'undefined') {
    g.KeyboardEvent = KeyboardEventStub;
  }
  if (typeof g.MutationObserver === 'undefined') {
    g.MutationObserver = MutationObserverStub;
  }
  if (typeof g.ResizeObserver === 'undefined') {
    g.ResizeObserver = ResizeObserverStub;
  }
  if (typeof g.IntersectionObserver === 'undefined') {
    g.IntersectionObserver = IntersectionObserverStub;
  }
  if (typeof g.window === 'undefined') {
    g.window = g;
  }
  if (g.window && typeof g.window.__swc === 'undefined') {
    g.window.__swc = { issuedWarnings: new Set() };
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
