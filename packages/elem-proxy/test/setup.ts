// Minimal DOM shim for lit-html in Node.js testing environment
const doc = {
  createComment: (str = '') => ({ nodeType: 8, textContent: str }),
  createTextNode: (str = '') => ({ nodeType: 3, textContent: str }),
  createElement: (tag = 'div') => {
    const el = new (globalThis.HTMLElement || class {})();
    (el as any).tagName = tag.toUpperCase();
    return el;
  },
  createTreeWalker: () => ({
    nextNode: () => null,
  }),
  createDocumentFragment: () => ({
    childNodes: [],
    appendChild: () => {},
  }),
};

globalThis.document = doc as any;
(global as any).document = doc;

globalThis.HTMLElement = class HTMLElement {
  shadowRoot: any = null;
  attributes = new Map();
  attachShadow(opts: any) {
    this.shadowRoot = {
      mode: opts.mode,
      adoptedStyleSheets: [],
      childNodes: [],
      innerHTML: '',
      firstChild: null,
      appendChild: () => {},
      removeChild: () => {},
      insertBefore: (node: any) => node,
    };
    return this.shadowRoot;
  }
  getAttribute(name: string) {
    return this.attributes.get(name) ?? null;
  }
  setAttribute(name: string, val: string) {
    this.attributes.set(name, String(val));
  }
  hasAttribute(name: string) {
    return this.attributes.has(name);
  }
  removeAttribute(name: string) {
    this.attributes.delete(name);
  }
} as any;
