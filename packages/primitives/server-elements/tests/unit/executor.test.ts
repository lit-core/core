import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { executePatches, resolveNodeByPath, resolveRangeMarkers } from '../../src/executor.js';

// DOM mock implementation for unit testing in node environment
class MockNode {
  nodeType: number;
  childNodes: MockNode[] = [];
  parentNode: MockNode | null = null;
  ownerDocument: any = null;

  constructor(nodeType: number) {
    this.nodeType = nodeType;
  }

  get firstChild(): MockNode | null {
    return this.childNodes[0] || null;
  }

  get firstElementChild(): MockElement | null {
    return (this.childNodes.find((c) => c.nodeType === 1) as MockElement) || null;
  }

  get previousSibling(): MockNode | null {
    if (!this.parentNode) return null;
    const idx = this.parentNode.childNodes.indexOf(this);
    return idx > 0 ? this.parentNode.childNodes[idx - 1] : null;
  }

  get nextSibling(): MockNode | null {
    if (!this.parentNode) return null;
    const idx = this.parentNode.childNodes.indexOf(this);
    return idx >= 0 && idx < this.parentNode.childNodes.length - 1 ? this.parentNode.childNodes[idx + 1] : null;
  }

  appendChild(child: MockNode): MockNode {
    if (child.parentNode) {
      child.parentNode.removeChild(child);
    }
    child.parentNode = this;
    child.ownerDocument = this.ownerDocument;
    this.childNodes.push(child);
    return child;
  }

  insertBefore(newChild: MockNode, refChild: MockNode | null): MockNode {
    if (!refChild) {
      return this.appendChild(newChild);
    }
    const idx = this.childNodes.indexOf(refChild);
    if (idx === -1) {
      return this.appendChild(newChild);
    }
    if (newChild.nodeType === 11) {
      // DocumentFragment
      const fragChildren = [...newChild.childNodes];
      for (const fc of fragChildren) {
        newChild.removeChild(fc);
        this.insertBefore(fc, refChild);
      }
      return newChild;
    }
    if (newChild.parentNode) {
      newChild.parentNode.removeChild(newChild);
    }
    newChild.parentNode = this;
    newChild.ownerDocument = this.ownerDocument;
    const insertIdx = this.childNodes.indexOf(refChild);
    this.childNodes.splice(insertIdx, 0, newChild);
    return newChild;
  }

  removeChild(child: MockNode): MockNode {
    const idx = this.childNodes.indexOf(child);
    if (idx !== -1) {
      this.childNodes.splice(idx, 1);
      child.parentNode = null;
    }
    return child;
  }
}

class MockTextNode extends MockNode {
  nodeValue: string;
  constructor(text: string) {
    super(3);
    this.nodeValue = text;
  }
}

class MockCommentNode extends MockNode {
  data: string;
  constructor(data: string) {
    super(8);
    this.data = data;
  }
}

class MockPINode extends MockNode {
  target: string;
  data: string;
  constructor(target: string, data: string) {
    super(7);
    this.target = target;
    this.data = data;
  }
}

class MockElement extends MockNode {
  tagName: string;
  attributes = new Map<string, string>();
  selectionStart: number | null = null;
  selectionEnd: number | null = null;
  value = '';

  constructor(tagName: string) {
    super(1);
    this.tagName = tagName.toUpperCase();
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  setAttribute(name: string, val: string): void {
    this.attributes.set(name, String(val));
  }

  removeAttribute(name: string): void {
    this.attributes.delete(name);
  }

  setSelectionRange(start: number, end: number): void {
    this.selectionStart = start;
    this.selectionEnd = end;
  }

  get textContent(): string {
    return this.childNodes
      .map((c) => {
        if (c.nodeType === 3) return (c as MockTextNode).nodeValue;
        if (c.nodeType === 1) return (c as MockElement).textContent;
        return '';
      })
      .join('');
  }

  set textContent(str: string) {
    this.childNodes = [];
    if (str.length > 0) {
      this.appendChild(new MockTextNode(str));
    }
  }

  set innerHTML(html: string) {
    this.childNodes = [];
    // Basic innerHTML parser for testing
    if (html.startsWith('<') && html.endsWith('>')) {
      const tagMatch = html.match(/<([a-zA-Z0-9-]+)([^>]*)>(.*)<\/\1>/s);
      if (tagMatch) {
        const [, tagName, attrStr, inner] = tagMatch;
        const el = new MockElement(tagName);
        const attrMatches = attrStr.matchAll(/([a-zA-Z0-9-]+)="([^"]*)"/g);
        for (const m of attrMatches) {
          el.setAttribute(m[1], m[2]);
        }
        el.textContent = inner;
        this.appendChild(el);
        return;
      }
    }
    this.textContent = html;
  }
}

class MockDocument {
  activeElement: MockElement | null = null;

  createElement(tagName: string): MockElement {
    const el = new MockElement(tagName);
    el.ownerDocument = this;
    if (tagName.toLowerCase() === 'template') {
      (el as any).content = new MockNode(11); // DocumentFragment
      Object.defineProperty(el, 'innerHTML', {
        set(html: string) {
          const content = (el as any).content;
          content.childNodes = [];
          const m = html.match(/<([a-zA-Z0-9-]+)([^>]*)>(.*)<\/\1>/s);
          if (m) {
            const childEl = new MockElement(m[1]);
            const attrMatches = m[2].matchAll(/([a-zA-Z0-9-]+)="([^"]*)"/g);
            for (const am of attrMatches) {
              childEl.setAttribute(am[1], am[2]);
            }
            childEl.textContent = m[3];
            content.appendChild(childEl);
          } else {
            content.appendChild(new MockTextNode(html));
          }
        },
      });
    }
    return el;
  }

  createTextNode(text: string): MockTextNode {
    const t = new MockTextNode(text);
    t.ownerDocument = this;
    return t;
  }

  createComment(data: string): MockCommentNode {
    const c = new MockCommentNode(data);
    c.ownerDocument = this;
    return c;
  }

  createTreeWalker(root: MockNode, _whatToShow: number) {
    const nodes: MockNode[] = [];
    function collect(n: MockNode) {
      nodes.push(n);
      for (const child of n.childNodes) {
        collect(child);
      }
    }
    for (const c of root.childNodes) {
      collect(c);
    }
    let idx = -1;
    return {
      currentNode: root,
      nextNode() {
        idx++;
        if (idx < nodes.length) {
          this.currentNode = nodes[idx];
          return true;
        }
        return false;
      },
    };
  }
}

describe('client Declarative Shadow DOM patch executor', () => {
  let doc: MockDocument;
  let originalWindow: any;
  let originalDocument: any;

  beforeEach(() => {
    doc = new MockDocument();
    originalWindow = (globalThis as any).window;
    originalDocument = (globalThis as any).document;
    (globalThis as any).document = doc;
    (globalThis as any).window = globalThis;
  });

  afterEach(() => {
    (globalThis as any).window = originalWindow;
    (globalThis as any).document = originalDocument;
  });

  it('resolves nodes by numeric child index path', () => {
    const root = doc.createElement('div');
    const child1 = doc.createElement('span');
    const child2 = doc.createElement('p');
    const grandChild = doc.createElement('b');

    child2.appendChild(grandChild);
    root.appendChild(child1);
    root.appendChild(child2);

    expect(resolveNodeByPath(root, [0])).toBe(child1);
    expect(resolveNodeByPath(root, [1])).toBe(child2);
    expect(resolveNodeByPath(root, [1, 0])).toBe(grandChild);
    expect(resolveNodeByPath(root, [2])).toBeNull();
  });

  it('resolves comment range markers', () => {
    const root = doc.createElement('div');
    const start = doc.createComment('?start name="p0"');
    const text = doc.createTextNode('Hello');
    const end = doc.createComment('?end');

    root.appendChild(start);
    root.appendChild(text);
    root.appendChild(end);

    const markers = resolveRangeMarkers(root, 'p0');
    expect(markers).not.toBeNull();
    expect(markers?.start).toBe(start);
    expect(markers?.end).toBe(end);
  });

  it('resolves processing instruction range markers', () => {
    const root = doc.createElement('div');
    const start = new MockPINode('start', 'name="p1"');
    start.ownerDocument = doc;
    const text = doc.createTextNode('Processing Instruction Content');
    const end = new MockPINode('end', '');
    end.ownerDocument = doc;

    root.appendChild(start);
    root.appendChild(text);
    root.appendChild(end);

    const markers = resolveRangeMarkers(root, 'p1');
    expect(markers).not.toBeNull();
    expect(markers?.start).toBe(start);
    expect(markers?.end).toBe(end);
  });

  it('updates state snapshot frame and sets data-lit-sig', () => {
    const host = doc.createElement('my-element') as any;
    executePatches(host as any, {
      s: { count: 10, theme: 'dark' },
      sig: '1730000000.abc12345',
    });

    expect(host.__litState).toEqual({ count: 10, theme: 'dark' });
    expect(host.__litSig).toBe('1730000000.abc12345');
    expect(host.getAttribute('data-lit-sig')).toBe('1730000000.abc12345');
  });

  it('patches element-anchored property and preserves cursor selection', () => {
    const host = doc.createElement('form-component') as any;
    const input = doc.createElement('input');
    input.value = 'initial text';
    input.selectionStart = 3;
    input.selectionEnd = 7;
    doc.activeElement = input;

    const shadow = doc.createElement('div');
    shadow.appendChild(input);
    host.shadowRoot = shadow;

    // Define part descriptor on constructor
    (host.constructor as any).__litParts = [{ k: 'element', path: [0], attr: 'value', prefix: '.' }];

    executePatches(host as any, { p: 0, v: 'updated text' });

    expect((input as any).value).toBe('updated text');
    expect(input.selectionStart).toBe(3);
    expect(input.selectionEnd).toBe(7);
  });

  it('patches element-anchored boolean and standard attributes', () => {
    const host = doc.createElement('button-comp') as any;
    const btn = doc.createElement('button');
    const shadow = doc.createElement('div');
    shadow.appendChild(btn);
    host.shadowRoot = shadow;

    (host.constructor as any).__litParts = [
      { k: 'element', path: [0], attr: 'disabled', prefix: '?' },
      { k: 'element', path: [0], attr: 'aria-label', prefix: '' },
    ];

    // Set boolean true and aria-label
    executePatches(host as any, [
      { p: 0, v: true },
      { p: 1, v: 'Submit Form' },
    ]);
    expect(btn.getAttribute('disabled')).toBe('');
    expect(btn.getAttribute('aria-label')).toBe('Submit Form');

    // Set boolean false and remove aria-label
    executePatches(host as any, [
      { p: 0, v: false },
      { p: 1, v: null },
    ]);
    expect(btn.getAttribute('disabled')).toBeNull();
    expect(btn.getAttribute('aria-label')).toBeNull();
  });

  it('patches sole-text-child directly via parent textContent', () => {
    const host = doc.createElement('label-comp') as any;
    const span = doc.createElement('span');
    span.textContent = 'Old text';
    const shadow = doc.createElement('div');
    shadow.appendChild(span);
    host.shadowRoot = shadow;

    (host.constructor as any).__litParts = [{ k: 'sole-text', path: [0] }];

    executePatches(host as any, { p: 0, v: 'New text' });
    expect(span.textContent).toBe('New text');
  });

  it('patches range-addressed scalar value in place mutating existing text node', () => {
    const host = doc.createElement('counter-comp') as any;
    const shadow = doc.createElement('div');
    const start = doc.createComment('?start name="p0"');
    const textNode = doc.createTextNode('42');
    const end = doc.createComment('?end');

    shadow.appendChild(start);
    shadow.appendChild(textNode);
    shadow.appendChild(end);
    host.shadowRoot = shadow;

    (host.constructor as any).__litParts = [{ k: 'range', name: 'p0', startPath: [0] }];

    executePatches(host as any, { p: 0, v: 43 });

    // Node reference is preserved (in-place mutation)
    expect(start.nextSibling).toBe(textNode);
    expect(textNode.nodeValue).toBe('43');
    expect(textNode.nextSibling).toBe(end);
  });

  it('patches structural branch swaps by clearing old nodes and inserting fragment', () => {
    const host = doc.createElement('conditional-comp') as any;
    const shadow = doc.createElement('div');
    const start = doc.createComment('?start name="p0"');
    const oldNode = doc.createElement('span');
    oldNode.textContent = 'Loading...';
    const end = doc.createComment('?end');

    shadow.appendChild(start);
    shadow.appendChild(oldNode);
    shadow.appendChild(end);
    host.shadowRoot = shadow;

    (host.constructor as any).__litParts = [{ k: 'range', name: 'p0', startPath: [0] }];

    executePatches(host as any, {
      p: 0,
      f: '<p class="content">Content loaded</p>',
      h: 'hash-abc',
    });

    expect(oldNode.parentNode).toBeNull();
    const inserted = start.nextSibling as MockElement;
    expect(inserted.tagName).toBe('P');
    expect(inserted.textContent).toBe('Content loaded');
    expect(inserted.getAttribute('class')).toBe('content');
    expect(inserted.nextSibling).toBe(end);
  });

  it('reconciles keyed list reusing DOM elements and updating order', () => {
    const host = doc.createElement('list-comp') as any;
    const shadow = doc.createElement('div');
    const start = doc.createComment('?start name="p0"');
    const end = doc.createComment('?end');

    shadow.appendChild(start);
    shadow.appendChild(end);
    host.shadowRoot = shadow;

    (host.constructor as any).__litParts = [{ k: 'range', name: 'p0', startPath: [0] }];

    // Initial list: items A, B, C
    executePatches(host as any, {
      p: 0,
      k: [
        { key: 'a', html: '<li data-lit-key="a">A</li>' },
        { key: 'b', html: '<li data-lit-key="b">B</li>' },
        { key: 'c', html: '<li data-lit-key="c">C</li>' },
      ],
    });

    const nodeA = start.nextSibling as MockElement;
    const nodeB = nodeA.nextSibling as MockElement;
    const nodeC = nodeB.nextSibling as MockElement;

    expect(nodeA.getAttribute('data-lit-key')).toBe('a');
    expect(nodeB.getAttribute('data-lit-key')).toBe('b');
    expect(nodeC.getAttribute('data-lit-key')).toBe('c');
    expect(nodeC.nextSibling).toBe(end);

    // Reorder: C, A, D (B is removed, D is added)
    executePatches(host as any, {
      p: 0,
      k: [
        { key: 'c', html: '<li data-lit-key="c">C</li>' },
        { key: 'a', html: '<li data-lit-key="a">A</li>' },
        { key: 'd', html: '<li data-lit-key="d">D</li>' },
      ],
    });

    // Check that existing instances of A and C were reused!
    const newFirst = start.nextSibling as MockElement;
    const newSecond = newFirst.nextSibling as MockElement;
    const newThird = newSecond.nextSibling as MockElement;

    expect(newFirst).toBe(nodeC);
    expect(newSecond).toBe(nodeA);
    expect(newThird.getAttribute('data-lit-key')).toBe('d');
    expect(nodeB.parentNode).toBeNull(); // Node B was unmounted
  });
});
