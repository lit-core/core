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

const VOID_HTML_TAGS = new Set(['AREA', 'BASE', 'BR', 'COL', 'EMBED', 'HR', 'IMG', 'INPUT', 'LINK', 'META', 'PARAM', 'SOURCE', 'TRACK', 'WBR']);

function decodeHtmlEntities(raw: string): string {
  return raw
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function parseAttributesString(attrStr: string): Map<string, string> {
  const map = new Map<string, string>();
  const attrRegex = /([a-zA-Z0-9_:$@.?-]+)(?:=(?:"([^"]*)"|'([^']*)'|([^>\s]+)))?/g;
  let match = attrRegex.exec(attrStr);
  while (match !== null) {
    const key = match[1];
    const val = match[2] ?? match[3] ?? match[4] ?? '';
    map.set(key, decodeHtmlEntities(val));
    match = attrRegex.exec(attrStr);
  }
  return map;
}

function parseHtmlIntoNode(html: string, rootParent: any): void {
  const stack: any[] = [rootParent];
  let i = 0;
  const len = html.length;

  while (i < len) {
    const currentParent = stack[stack.length - 1];
    const lt = html.indexOf('<', i);
    if (lt === -1) {
      const text = decodeHtmlEntities(html.slice(i));
      if (text.length > 0) {
        currentParent.appendChild(documentMock.createTextNode(text));
      }
      break;
    }

    if (lt > i) {
      const text = decodeHtmlEntities(html.slice(i, lt));
      if (text.length > 0) {
        currentParent.appendChild(documentMock.createTextNode(text));
      }
    }

    // Comment <!-- ... -->
    if (html.startsWith('<!--', lt)) {
      const endComment = html.indexOf('-->', lt + 4);
      if (endComment === -1) {
        currentParent.appendChild(documentMock.createComment(html.slice(lt + 4)));
        break;
      }
      currentParent.appendChild(documentMock.createComment(html.slice(lt + 4, endComment)));
      i = endComment + 3;
      continue;
    }

    // Bogus comment / processing instruction <?...> (HTML5 parses <?...> as a comment node!)
    if (html.startsWith('<?', lt)) {
      const gt = html.indexOf('>', lt + 2);
      if (gt === -1) {
        currentParent.appendChild(documentMock.createComment(html.slice(lt + 1)));
        break;
      }
      currentParent.appendChild(documentMock.createComment(html.slice(lt + 1, gt)));
      i = gt + 1;
      continue;
    }

    // Closing tag </tag>
    if (html.startsWith('</', lt)) {
      const gt = html.indexOf('>', lt + 2);
      if (gt === -1) break;
      const closeTag = html
        .slice(lt + 2, gt)
        .trim()
        .toUpperCase();
      for (let s = stack.length - 1; s >= 1; s--) {
        if (stack[s].tagName === closeTag) {
          stack.length = s;
          break;
        }
      }
      i = gt + 1;
      continue;
    }

    // Opening tag <tag ...>
    let cursor = lt + 1;
    let quote: string | null = null;
    while (cursor < len) {
      const ch = html[cursor];
      if (quote) {
        if (ch === quote) quote = null;
      } else if (ch === '"' || ch === "'") {
        quote = ch;
      } else if (ch === '>') {
        break;
      }
      cursor++;
    }
    if (cursor >= len) break;

    const rawTagContent = html.slice(lt + 1, cursor);
    const selfClosing = rawTagContent.trimEnd().endsWith('/');
    const cleanTagContent = selfClosing ? rawTagContent.trimEnd().slice(0, -1) : rawTagContent;
    const spaceIdx = cleanTagContent.search(/\s/);
    const rawTagName = spaceIdx === -1 ? cleanTagContent : cleanTagContent.slice(0, spaceIdx);
    const attrStr = spaceIdx === -1 ? '' : cleanTagContent.slice(spaceIdx);
    const tagName = rawTagName.toUpperCase();

    if (!tagName || !/^[A-Z0-9_-]+$/.test(tagName)) {
      currentParent.appendChild(documentMock.createTextNode(html[lt]));
      i = lt + 1;
      continue;
    }

    const lowerTag = tagName.toLowerCase();
    const ctor = customElements.get(lowerTag);
    const el = tagName === 'TEMPLATE' ? new MockTemplateElement() : ctor ? new ctor() : new MockElement();
    el.tagName = tagName;

    const attrs = parseAttributesString(attrStr);
    for (const [k, v] of attrs) {
      el.setAttribute(k, v);
    }

    currentParent.appendChild(el);
    i = cursor + 1;

    if (selfClosing || VOID_HTML_TAGS.has(tagName)) {
      continue;
    }

    if (tagName === 'SCRIPT' || tagName === 'STYLE') {
      const closeRe = new RegExp(`</${tagName}\\s*>`, 'gi');
      closeRe.lastIndex = i;
      const closeMatch = closeRe.exec(html);
      if (closeMatch) {
        el.textContent = html.slice(i, closeMatch.index);
        i = closeMatch.index + closeMatch[0].length;
      } else {
        el.textContent = html.slice(i);
        break;
      }
      continue;
    }

    if (tagName === 'TEMPLATE') {
      // Find balanced closing </template>
      let depth = 1;
      let scan = i;
      let endStart = len;
      let afterEnd = len;
      const tmplRe = /<\/?template(?:\s[^>]*)?>/gi;
      tmplRe.lastIndex = scan;
      let m = tmplRe.exec(html);
      while (m !== null) {
        if (m[0].startsWith('</')) {
          depth--;
          if (depth === 0) {
            endStart = m.index;
            afterEnd = m.index + m[0].length;
            break;
          }
        } else if (!m[0].endsWith('/>')) {
          depth++;
        }
        scan = m.index + m[0].length;
        tmplRe.lastIndex = scan;
        m = tmplRe.exec(html);
      }
      const inner = html.slice(i, endStart);
      (el as MockTemplateElement).content.innerHTML = inner;
      i = afterEnd;
      continue;
    }

    stack.push(el);
  }
}

class MockNode {
  nodeType = 1;
  parentNode: any = null;
  childNodes: any[] = [];
  _nodeValue = '';

  get ownerDocument(): any {
    return documentMock;
  }

  get isConnected(): boolean {
    return true;
  }

  get firstChild(): any {
    return this.childNodes[0] ?? null;
  }

  get lastChild(): any {
    return this.childNodes[this.childNodes.length - 1] ?? null;
  }

  get previousSibling(): any {
    if (!this.parentNode) return null;
    const idx = this.parentNode.childNodes.indexOf(this);
    return idx > 0 ? this.parentNode.childNodes[idx - 1] : null;
  }

  get nextSibling(): any {
    if (!this.parentNode) return null;
    const idx = this.parentNode.childNodes.indexOf(this);
    return idx !== -1 && idx + 1 < this.parentNode.childNodes.length ? this.parentNode.childNodes[idx + 1] : null;
  }

  get data(): string {
    return this._nodeValue;
  }
  set data(val: string) {
    this._nodeValue = String(val);
  }

  get textContent(): string {
    if (this.nodeType === 3 || this.nodeType === 8) {
      return this._nodeValue;
    }
    return this.childNodes.map((c) => (c.nodeType === 8 ? '' : c.textContent)).join('');
  }
  set textContent(val: string) {
    if (this.nodeType === 3 || this.nodeType === 8) {
      this._nodeValue = String(val);
      return;
    }
    this.childNodes = [];
    if (val) {
      this.appendChild(documentMock.createTextNode(String(val)));
    }
  }

  splitText(offset: number): MockNode {
    const current = this._nodeValue;
    this._nodeValue = current.slice(0, offset);
    const tail = documentMock.createTextNode(current.slice(offset));
    if (this.parentNode) {
      this.parentNode.insertBefore(tail, this.nextSibling);
    }
    return tail;
  }

  appendChild(child: any) {
    return this.insertBefore(child, null);
  }

  insertBefore(child: any, refNode: any) {
    if (child.nodeType === 11) {
      const children = [...child.childNodes];
      child.childNodes = [];
      for (const c of children) {
        c.parentNode = null;
        this.insertBefore(c, refNode);
      }
      return child;
    }
    if (child.parentNode) {
      child.parentNode.removeChild(child);
    }
    child.parentNode = this;
    if (refNode == null) {
      this.childNodes.push(child);
    } else {
      const idx = this.childNodes.indexOf(refNode);
      if (idx === -1) {
        this.childNodes.push(child);
      } else {
        this.childNodes.splice(idx, 0, child);
      }
    }
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
    if (this instanceof MockTemplateElement) {
      const clone = new MockTemplateElement();
      clone.attributes = new Map(this.attributes);
      if (deep) {
        clone.content = this.content.cloneNode(true);
      }
      return clone;
    }
    const clone = Object.create(Object.getPrototypeOf(this));
    clone.nodeType = this.nodeType;
    clone.parentNode = null;
    clone.childNodes = [];
    clone._nodeValue = this._nodeValue;
    if (this instanceof MockElement) {
      clone.tagName = this.tagName;
      clone.attributes = new Map(this.attributes);
      clone.listeners = new Map();
      clone.shadowRoot = null;
      clone._innerHTML = this._innerHTML;
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
  listeners = new Map<string, Array<{ fn: (...args: any[]) => any; capture: boolean }>>();
  get localName(): string {
    return this.tagName.toLowerCase();
  }
  shadowRoot: any = null;
  _innerHTML = '';

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
  getAttributeNames(): string[] {
    return [...this.attributes.keys()];
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
  toggleAttribute(name: string, force?: boolean): boolean {
    const has = this.hasAttribute(name);
    const shouldHave = force !== undefined ? force : !has;
    if (shouldHave) {
      if (!has) this.setAttribute(name, '');
      return true;
    }
    if (has) this.removeAttribute(name);
    return false;
  }

  attachShadow(init: any = { mode: 'open' }) {
    if (this.shadowRoot) {
      this.shadowRoot.childNodes = [];
      return this.shadowRoot;
    }
    const shadow = new MockShadowRoot(this, init);
    this.shadowRoot = shadow;
    return shadow;
  }

  addEventListener(type: string, fn: any, opts: any = false) {
    const capture = typeof opts === 'boolean' ? opts : (opts?.capture ?? false);
    if (!this.listeners.has(type)) {
      this.listeners.set(type, []);
    }
    this.listeners.get(type)?.push({ fn, capture });
  }

  removeEventListener(type: string, fn: any, opts: any = false) {
    const capture = typeof opts === 'boolean' ? opts : (opts?.capture ?? false);
    const list = this.listeners.get(type);
    if (!list) return;
    this.listeners.set(
      type,
      list.filter((l) => l.fn !== fn || l.capture !== capture),
    );
  }

  dispatchEvent(event: any): boolean {
    if (!event.target) {
      event.target = this;
    }
    event.currentTarget = this;
    const list = this.listeners.get(event.type) || [];
    for (const item of [...list]) {
      if (typeof item.fn === 'function') {
        item.fn.call(this, event);
      } else if (item.fn && typeof item.fn.handleEvent === 'function') {
        item.fn.handleEvent(event);
      }
      if (event.immediatePropagationStopped) break;
    }

    const nextParent = this.parentNode || (this as any).host;
    if (event.bubbles && !event.propagationStopped && nextParent && typeof nextParent.dispatchEvent === 'function') {
      nextParent.dispatchEvent(event);
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
      if (child?.nodeType !== 1) return false;
      if (clean === '*') return true;
      if (clean.startsWith('.')) {
        return Boolean(child.getAttribute('class')?.split(/\s+/).includes(clean.slice(1)));
      }
      if (clean.startsWith('#')) {
        return child.getAttribute('id') === clean.slice(1);
      }
      const tagIdMatch = /^([a-zA-Z0-9_-]+)#([a-zA-Z0-9_-]+)$/.exec(clean);
      if (tagIdMatch) {
        return child.tagName?.toLowerCase() === tagIdMatch[1].toLowerCase() && child.getAttribute('id') === tagIdMatch[2];
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

  get children(): any[] {
    return this.childNodes.filter((n) => n.nodeType === 1);
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
  listeners = new Map<string, Array<{ fn: (...args: any[]) => any; capture: boolean }>>();
  constructor(host: any, init: any) {
    super();
    this.host = host;
    this.mode = init?.mode || 'open';
  }
  addEventListener(type: string, fn: (...args: any[]) => any, opts: any = false) {
    return MockElement.prototype.addEventListener.call(this, type, fn, opts);
  }
  removeEventListener(type: string, fn: (...args: any[]) => any, opts: any = false) {
    return MockElement.prototype.removeEventListener.call(this, type, fn, opts);
  }
  dispatchEvent(event: any): boolean {
    return MockElement.prototype.dispatchEvent.call(this, event);
  }
}

class MockTemplateElement extends MockElement {
  tagName = 'TEMPLATE';
  content = new MockDocumentFragment();
  override get innerHTML(): string {
    return this.content.innerHTML;
  }
  override set innerHTML(html: string) {
    this._innerHTML = html;
    this.content.innerHTML = html;
  }
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
      this.promises.get(lower)?.resolve();
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
    return this.promises.get(lower)?.promise as Promise<void>;
  }
}

function nodeTypeMatchesFilter(nodeType: number, whatToShow: number): boolean {
  if (whatToShow === 0xffffffff || whatToShow === -1) return true;
  if (nodeType === 1 && (whatToShow & 1) !== 0) return true;
  if (nodeType === 3 && (whatToShow & 4) !== 0) return true;
  if (nodeType === 8 && (whatToShow & 128) !== 0) return true;
  if (nodeType === 11 && (whatToShow & 1024) !== 0) return true;
  return false;
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
    n.data = str;
    return n;
  },
  createComment(str = '') {
    const n = new MockNode();
    n.nodeType = 8;
    n.data = str;
    return n;
  },
  createTreeWalker(root: any, whatToShow = 0xffffffff) {
    const nodes: any[] = [];
    function collect(n: any, isRoot: boolean) {
      if (!isRoot && nodeTypeMatchesFilter(n.nodeType, whatToShow)) {
        nodes.push(n);
      }
      for (const c of n.childNodes || []) {
        collect(c, false);
      }
    }
    collect(root, true);
    let cursor = -1;
    return {
      get currentNode() {
        return cursor >= 0 && cursor < nodes.length ? nodes[cursor] : root;
      },
      nextNode() {
        cursor++;
        return cursor < nodes.length ? nodes[cursor] : null;
      },
    };
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
  innerHeight: 800,
  Event: MockEvent,
  CustomEvent: MockCustomEvent,
  MouseEvent: MockMouseEvent,
  PointerEvent: MockPointerEvent,
  KeyboardEvent: MockKeyboardEvent,
  FocusEvent: MockFocusEvent,
  Node: MockNode,
  HTMLElement: MockElement,
  HTMLTemplateElement: MockTemplateElement,
  addEventListener(type: string, fn: (...args: any[]) => any, opts: any) {
    body.addEventListener(type, fn, opts);
  },
  removeEventListener(type: string, fn: (...args: any[]) => any, opts: any) {
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
