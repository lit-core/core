// Minimal DOM and Custom Elements environment for Vitest in Node.js

class MockEvent {
  type: string;
  bubbles: boolean;
  cancelable: boolean;
  composed: boolean;
  defaultPrevented = false;
  propagationStopped = false;
  immediatePropagationStopped = false;
  target: any = null;
  currentTarget: any = null;
  timeStamp = Date.now();

  constructor(type: string, init: any = {}) {
    this.type = type;
    this.bubbles = init.bubbles ?? true;
    this.cancelable = init.cancelable ?? true;
    this.composed = init.composed ?? true;
  }

  preventDefault() {
    if (this.cancelable) {
      this.defaultPrevented = true;
    }
  }

  stopPropagation() {
    this.propagationStopped = true;
  }

  stopImmediatePropagation() {
    this.immediatePropagationStopped = true;
    this.propagationStopped = true;
  }

  composedPath() {
    const path: any[] = [];
    let curr = this.target;
    while (curr) {
      path.push(curr);
      curr = curr.parentNode || curr.host;
    }
    if (path.length > 0 && typeof window !== 'undefined') {
      path.push(document);
      path.push(window);
    }
    return path;
  }
}

class MockCustomEvent extends MockEvent {
  detail: any;
  constructor(type: string, init: any = {}) {
    super(type, init);
    this.detail = init.detail;
  }
}

class MockMouseEvent extends MockEvent {
  clientX: number;
  clientY: number;
  screenX: number;
  screenY: number;
  button: number;
  buttons: number;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;

  constructor(type: string, init: any = {}) {
    super(type, init);
    this.clientX = init.clientX ?? 0;
    this.clientY = init.clientY ?? 0;
    this.screenX = init.screenX ?? 0;
    this.screenY = init.screenY ?? 0;
    this.button = init.button ?? 0;
    this.buttons = init.buttons ?? 0;
    this.ctrlKey = init.ctrlKey ?? false;
    this.shiftKey = init.shiftKey ?? false;
    this.altKey = init.altKey ?? false;
    this.metaKey = init.metaKey ?? false;
  }
}

class MockPointerEvent extends MockMouseEvent {
  pointerId: number;
  pointerType: string;
  isPrimary: boolean;

  constructor(type: string, init: any = {}) {
    super(type, init);
    this.pointerId = init.pointerId ?? 1;
    this.pointerType = init.pointerType ?? 'mouse';
    this.isPrimary = init.isPrimary ?? true;
  }
}

class MockKeyboardEvent extends MockEvent {
  key: string;
  code: string;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;

  constructor(type: string, init: any = {}) {
    super(type, init);
    this.key = init.key ?? '';
    this.code = init.code ?? '';
    this.ctrlKey = init.ctrlKey ?? false;
    this.shiftKey = init.shiftKey ?? false;
    this.altKey = init.altKey ?? false;
    this.metaKey = init.metaKey ?? false;
  }
}

class MockFocusEvent extends MockEvent {
  relatedTarget: any;
  constructor(type: string, init: any = {}) {
    super(type, init);
    this.relatedTarget = init.relatedTarget ?? null;
  }
}

function parseAttributesString(attrStr: string): Map<string, string> {
  const map = new Map<string, string>();
  const attrRegex = /([a-zA-Z0-9_-]+)(?:=(?:"([^"]*)"|'([^']*)'|([^>\s]+)))?/g;
  let match = attrRegex.exec(attrStr);
  while (match !== null) {
    const key = match[1];
    const val = match[2] ?? match[3] ?? match[4] ?? '';
    map.set(key, val);
    match = attrRegex.exec(attrStr);
  }
  return map;
}

function parseHtmlIntoNode(html: string, parentNode: any): void {
  const tagRegex = /<([a-zA-Z0-9_-]+)((?:\s+[a-zA-Z0-9_-]+(?:=(?:"[^"]*"|'[^']*'|[^>\s]+))?)*)\s*(?:\/>|>([\s\S]*?)<\/\1>|>)/gi;
  let match = tagRegex.exec(html);

  while (match !== null) {
    const tagName = match[1].toUpperCase();
    const attrStr = match[2] || '';
    const inner = match[3] || '';

    const el = tagName === 'TEMPLATE' ? new MockTemplateElement() : customElements.get(tagName.toLowerCase()) ? new (customElements.get(tagName.toLowerCase()))() : new MockElement();

    el.tagName = tagName;
    const attrs = parseAttributesString(attrStr);
    for (const [k, v] of attrs) {
      el.setAttribute(k, v);
    }

    if (tagName === 'TEMPLATE') {
      (el as MockTemplateElement).content.innerHTML = inner;
    } else if (tagName === 'SCRIPT' || tagName === 'STYLE') {
      el.textContent = inner;
    } else if (inner.includes('<')) {
      el.innerHTML = inner;
    } else {
      el.textContent = inner;
    }

    parentNode.appendChild(el);
    match = tagRegex.exec(html);
  }
}

class MockNode {
  nodeType = 1;
  parentNode: any = null;
  childNodes: any[] = [];
  get isConnected(): boolean {
    return true;
  }
  appendChild(child: any) {
    if (child.nodeType === 11) {
      const children = [...child.childNodes];
      for (const c of children) {
        this.appendChild(c);
      }
      child.childNodes = [];
      return child;
    }
    child.parentNode = this;
    this.childNodes.push(child);
    return child;
  }
  removeChild(child: any) {
    const idx = this.childNodes.indexOf(child);
    if (idx !== -1) {
      this.childNodes.splice(idx, 1);
      child.parentNode = null;
    }
    return child;
  }
  remove() {
    if (this.parentNode) {
      this.parentNode.removeChild(this);
    }
  }
  cloneNode(deep = false): any {
    const clone = Object.create(Object.getPrototypeOf(this));
    clone.nodeType = this.nodeType;
    clone.childNodes = [];
    if (this instanceof MockElement) {
      clone.tagName = this.tagName;
      clone.attributes = new Map((this as any).attributes);
      clone.listeners = new Map();
      clone._textContent = (this as any)._textContent;
    }
    if (deep) {
      for (const c of this.childNodes) {
        const cClone = c.cloneNode(true);
        clone.appendChild(cClone);
      }
    }
    return clone;
  }
}

class MockElement extends MockNode {
  tagName = 'DIV';
  attributes = new Map<string, string>();
  listeners = new Map<string, Array<{ fn: Function; capture: boolean }>>();
  shadowRoot: any = null;
  _textContent = '';
  _innerHTML = '';

  get textContent(): string {
    if (this.childNodes.length > 0) {
      return this.childNodes.map((c) => c.textContent).join('');
    }
    return this._textContent;
  }
  set textContent(val: string) {
    this._textContent = val;
    this.childNodes = [];
  }

  get innerHTML(): string {
    return this._innerHTML;
  }
  set innerHTML(html: string) {
    this._innerHTML = html;
    this.childNodes = [];
    parseHtmlIntoNode(html, this);
  }

  get children(): any[] {
    return this.childNodes.filter((n) => n.nodeType === 1);
  }

  get firstElementChild(): any {
    return this.children[0] ?? null;
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }
  setAttribute(name: string, value: string) {
    this.attributes.set(name, String(value));
  }
  hasAttribute(name: string): boolean {
    return this.attributes.has(name);
  }
  removeAttribute(name: string) {
    this.attributes.delete(name);
  }

  attachShadow(init: any = { mode: 'open' }) {
    const shadow = new MockShadowRoot(this, init);
    this.shadowRoot = shadow;
    return shadow;
  }

  addEventListener(type: string, fn: Function, opts: any = false) {
    const capture = typeof opts === 'boolean' ? opts : (opts?.capture ?? false);
    if (!this.listeners.has(type)) {
      this.listeners.set(type, []);
    }
    this.listeners.get(type)!.push({ fn, capture });
  }

  removeEventListener(type: string, fn: Function, opts: any = false) {
    const capture = typeof opts === 'boolean' ? opts : (opts?.capture ?? false);
    const list = this.listeners.get(type);
    if (!list) return;
    this.listeners.set(
      type,
      list.filter((l) => l.fn !== fn || l.capture !== capture),
    );
  }

  dispatchEvent(event: any): boolean {
    event.target = this;
    const list = this.listeners.get(event.type) || [];
    for (const item of [...list]) {
      item.fn.call(this, event);
      if (event.immediatePropagationStopped) break;
    }

    if (event.bubbles && !event.propagationStopped && this.parentNode && typeof this.parentNode.dispatchEvent === 'function') {
      this.parentNode.dispatchEvent(event);
    }
    return !event.defaultPrevented;
  }

  querySelector(selector: string): any {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  querySelectorAll(selector: string): any[] {
    const results: any[] = [];
    const clean = selector.replace(':scope > ', '').replace(':scope', '').trim();

    function matchSelector(child: any): boolean {
      if (!child || child.nodeType !== 1) return false;
      if (clean === '*') return true;
      if (clean.startsWith('.')) {
        return Boolean(child.getAttribute('class')?.includes(clean.slice(1)));
      }
      if (clean.startsWith('#')) {
        return child.getAttribute('id') === clean.slice(1);
      }
      const attrMatch = /^(?:([a-zA-Z0-9_-]+))?\[([a-zA-Z0-9_-]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\]]+)))?\]$/.exec(clean);
      if (attrMatch) {
        const tag = attrMatch[1];
        const attrName = attrMatch[2];
        const attrVal = attrMatch[3] ?? attrMatch[4] ?? attrMatch[5];
        if (tag && child.tagName?.toLowerCase() !== tag.toLowerCase()) {
          return false;
        }
        if (!child.hasAttribute(attrName)) {
          return false;
        }
        if (attrVal !== undefined && child.getAttribute(attrName) !== attrVal) {
          return false;
        }
        return true;
      }
      return child.tagName?.toLowerCase() === clean.toLowerCase();
    }

    function walk(node: any) {
      for (const child of node.childNodes || []) {
        if (child.nodeType === 1) {
          if (matchSelector(child)) {
            results.push(child);
          }
          walk(child);
        }
      }
    }

    walk(this);
    return results;
  }
}

class MockDocumentFragment extends MockNode {
  nodeType = 11;
  _innerHTML = '';

  get innerHTML(): string {
    return this._innerHTML;
  }
  set innerHTML(html: string) {
    this._innerHTML = html;
    this.childNodes = [];
    parseHtmlIntoNode(html, this);
  }

  querySelector(selector: string): any {
    return MockElement.prototype.querySelector.call(this, selector);
  }
  querySelectorAll(selector: string): any[] {
    return MockElement.prototype.querySelectorAll.call(this, selector);
  }
  hasChildNodes(): boolean {
    return this.childNodes.length > 0;
  }
  dispatchEvent(event: any): boolean {
    if ((this as any).host && typeof (this as any).host.dispatchEvent === 'function') {
      return (this as any).host.dispatchEvent(event);
    }
    return true;
  }
}

class MockShadowRoot extends MockDocumentFragment {
  host: any;
  mode: string;
  constructor(host: any, init: any) {
    super();
    this.host = host;
    this.mode = init?.mode || 'open';
  }
}

class MockTemplateElement extends MockElement {
  tagName = 'TEMPLATE';
  content = new MockDocumentFragment();
}

class CustomElementRegistry {
  private defs = new Map<string, any>();
  private promises = new Map<string, { resolve: () => void; promise: Promise<void> }>();

  define(name: string, ctor: any) {
    const lower = name.toLowerCase();
    this.defs.set(lower, ctor);
    function upgrade(node: any) {
      if (node && node.tagName?.toLowerCase() === lower && !(node instanceof ctor)) {
        Object.setPrototypeOf(node, ctor.prototype);
        if (typeof node.connectedCallback === 'function') {
          node.connectedCallback();
        }
      }
      for (const child of node.childNodes || []) {
        upgrade(child);
      }
    }
    if (typeof document !== 'undefined' && document.body) {
      upgrade(document.body);
    }
    if (this.promises.has(lower)) {
      this.promises.get(lower)!.resolve();
      this.promises.delete(lower);
    }
  }

  get(name: string) {
    return this.defs.get(name.toLowerCase());
  }

  whenDefined(name: string): Promise<void> {
    const lower = name.toLowerCase();
    if (this.defs.has(lower)) {
      return Promise.resolve();
    }
    if (!this.promises.has(lower)) {
      let resolve!: () => void;
      const promise = new Promise<void>((res) => {
        resolve = res;
      });
      this.promises.set(lower, { resolve, promise });
    }
    return this.promises.get(lower)!.promise;
  }
}

// Setup globals
const customElements = new CustomElementRegistry();
const body = new MockElement();
body.tagName = 'BODY';
const head = new MockElement();
head.tagName = 'HEAD';

const documentMock = {
  body,
  head,
  createElement(tag: string) {
    const lower = tag.toLowerCase();
    const ctor = customElements.get(lower);
    const el = ctor ? new ctor() : lower === 'template' ? new MockTemplateElement() : new MockElement();
    el.tagName = tag.toUpperCase();
    return el;
  },
  createDocumentFragment() {
    return new MockDocumentFragment();
  },
  createTextNode(str = '') {
    const n = new MockNode();
    n.nodeType = 3;
    (n as any).textContent = str;
    return n;
  },
  createComment(str = '') {
    const n = new MockNode();
    n.nodeType = 8;
    (n as any).textContent = str;
    return n;
  },
  createTreeWalker() {
    return { nextNode: () => null };
  },
  querySelector(sel: string) {
    return body.querySelector(sel);
  },
  querySelectorAll(sel: string) {
    return body.querySelectorAll(sel);
  },
};

const windowMock = {
  document: documentMock,
  customElements,
  Event: MockEvent,
  CustomEvent: MockCustomEvent,
  MouseEvent: MockMouseEvent,
  PointerEvent: MockPointerEvent,
  KeyboardEvent: MockKeyboardEvent,
  FocusEvent: MockFocusEvent,
  Node: MockNode,
  HTMLElement: MockElement,
  HTMLTemplateElement: MockTemplateElement,
  addEventListener(type: string, fn: Function, opts: any) {
    body.addEventListener(type, fn, opts);
  },
  removeEventListener(type: string, fn: Function, opts: any) {
    body.removeEventListener(type, fn, opts);
  },
  dispatchEvent(event: any) {
    return body.dispatchEvent(event);
  },
};

(globalThis as any).window = windowMock;
(globalThis as any).document = documentMock;
(globalThis as any).customElements = customElements;
(globalThis as any).Event = MockEvent;
(globalThis as any).CustomEvent = MockCustomEvent;
(globalThis as any).MouseEvent = MockMouseEvent;
(globalThis as any).PointerEvent = MockPointerEvent;
(globalThis as any).KeyboardEvent = MockKeyboardEvent;
(globalThis as any).FocusEvent = MockFocusEvent;
(globalThis as any).Node = MockNode;
(globalThis as any).HTMLElement = MockElement;
(globalThis as any).HTMLTemplateElement = MockTemplateElement;
