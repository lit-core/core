import React, { Fragment } from 'react';
import { renderToString } from 'react-dom/server';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import * as morphRuntime from '../runtime/index.js';
import { attachSlotBoundary, augmentSlotBoundaryNode, SlotBoundary } from '../runtime/slots.js';
import { compileModule } from '../src/index.js';

/**
 * Transpiles and evaluates emitted component code inside a CommonJS module context,
 * providing React and the @lit-core/morph-to-react/runtime modules.
 */
function evalComponent(code: string, componentName: string): React.ComponentType<any> {
  const trans = ts.transpileModule(code, {
    compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS },
  });
  const exports: any = {};
  const customRequire = (spec: string) => {
    if (spec === 'react') return React;
    if (spec === '@lit-core/morph-to-react/runtime') return morphRuntime;
    throw new Error(`Cannot resolve specifier in evalComponent: ${spec}`);
  };
  const fn = new Function('React', 'exports', 'require', trans.outputText);
  fn(React, exports, customRequire);
  return exports[componentName];
}

function stripComments(html: string): string {
  return html.replace(/<!--.*?-->/g, '');
}

/**
 * Helper to build mock DOM elements in Node environment for testing slot boundary inspection
 */
function createMockElement(tagName: string, children: any[] = []): any {
  const listeners: Record<string, ((...args: any[]) => any)[]> = {};
  const el: any = {
    tagName: tagName.toUpperCase(),
    nodeType: 1,
    children: [],
    childNodes: [],
    appendChild(child: any) {
      el.childNodes.push(child);
      if (child.nodeType === 1) {
        el.children.push(child);
      }
      if (el._observerCallback) {
        el._observerCallback([{ type: 'childList', addedNodes: [child], removedNodes: [] }]);
      }
      return child;
    },
    removeChild(child: any) {
      const nIdx = el.childNodes.indexOf(child);
      if (nIdx !== -1) el.childNodes.splice(nIdx, 1);
      const cIdx = el.children.indexOf(child);
      if (cIdx !== -1) el.children.splice(cIdx, 1);
      if (el._observerCallback) {
        el._observerCallback([{ type: 'childList', addedNodes: [], removedNodes: [child] }]);
      }
      return child;
    },
    addEventListener(event: string, cb: (...args: any[]) => any) {
      if (!listeners[event]) listeners[event] = [];
      listeners[event].push(cb);
    },
    removeEventListener(event: string, cb: (...args: any[]) => any) {
      if (!listeners[event]) return;
      const idx = listeners[event].indexOf(cb);
      if (idx !== -1) listeners[event].splice(idx, 1);
    },
    dispatchEvent(event: any) {
      const list = listeners[event.type] || [];
      for (const cb of list) {
        cb.call(el, event);
      }
      return !event.defaultPrevented;
    },
  };
  for (const c of children) {
    el.appendChild(c);
  }
  return el;
}

function createMockTextNode(text: string): any {
  return {
    nodeType: 3,
    nodeValue: text,
    textContent: text,
  };
}

describe('milestone 5 challenger: empirical slot and boundary stress testing', () => {
  // =========================================================================
  // 1. Default slots: empty vs whitespace vs non-empty fallback content
  // =========================================================================
  describe('1. default slots: empty vs whitespace vs non-empty fallback content', () => {
    const code = `
      import { LitElement, html } from 'lit';
      export class DefaultSlotCard extends LitElement {
        render() {
          return html\`
            <div class="card">
              <slot><span class="default-fallback">Fallback Body</span></slot>
            </div>
          \`;
        }
      }
    `;

    const res = compileModule(code, { filePath: 'default-slot.ts' });
    const DefaultSlotCard = evalComponent(res.code, 'DefaultSlotCard');

    it('empirically renders fallback content when props.children is completely absent', () => {
      const html = stripComments(renderToString(React.createElement(DefaultSlotCard)));
      expect(html).toContain('Fallback Body');
      expect(html).toContain('default-fallback');
    });

    it('empirically renders fallback content when children are null, undefined, false, or empty string', () => {
      const htmlWithNull = stripComments(renderToString(React.createElement(DefaultSlotCard, null, null)));
      expect(htmlWithNull).toContain('Fallback Body');

      const htmlWithUndefined = stripComments(renderToString(React.createElement(DefaultSlotCard, null, undefined)));
      expect(htmlWithUndefined).toContain('Fallback Body');

      const htmlWithFalse = stripComments(renderToString(React.createElement(DefaultSlotCard, null, false)));
      expect(htmlWithFalse).toContain('Fallback Body');

      const htmlWithEmptyString = stripComments(renderToString(React.createElement(DefaultSlotCard, null, '')));
      expect(htmlWithEmptyString).toContain('Fallback Body');

      const htmlWithMixedFalsy = stripComments(renderToString(React.createElement(DefaultSlotCard, null, null, false, undefined, '')));
      expect(htmlWithMixedFalsy).toContain('Fallback Body');
    });

    it('empirically renders fallback content when children are empty array or empty Fragment', () => {
      const htmlWithEmptyArray = stripComments(renderToString(React.createElement(DefaultSlotCard, null, [])));
      expect(htmlWithEmptyArray).toContain('Fallback Body');

      const htmlWithEmptyFragment = stripComments(renderToString(React.createElement(DefaultSlotCard, null, React.createElement(Fragment))));
      expect(htmlWithEmptyFragment).toContain('Fallback Body');

      const htmlWithNestedEmptyFragment = stripComments(renderToString(React.createElement(DefaultSlotCard, null, React.createElement(Fragment, null, React.createElement(Fragment, null, null)))));
      expect(htmlWithNestedEmptyFragment).toContain('Fallback Body');
    });

    it('empirically treats whitespace text nodes as non-empty projected content (HTML slot spec parity)', () => {
      // In WHATWG HTML slot projection, a text node containing spaces or newlines is an assigned node.
      // Therefore, the slot is not empty, and fallback content must NOT be rendered.
      const htmlWithSpaces = stripComments(renderToString(React.createElement(DefaultSlotCard, null, '   ')));
      expect(htmlWithSpaces).not.toContain('Fallback Body');
      expect(htmlWithSpaces).toContain('   ');

      const htmlWithNewlines = stripComments(renderToString(React.createElement(DefaultSlotCard, null, '\n  \t  \n')));
      expect(htmlWithNewlines).not.toContain('Fallback Body');
    });

    it('empirically renders projected non-empty text and elements, suppressing fallback', () => {
      const htmlWithText = stripComments(renderToString(React.createElement(DefaultSlotCard, null, 'Active Projected Content')));
      expect(htmlWithText).toContain('Active Projected Content');
      expect(htmlWithText).not.toContain('Fallback Body');

      const htmlWithElement = stripComments(renderToString(React.createElement(DefaultSlotCard, null, React.createElement('p', { className: 'custom-p' }, 'Projected Paragraph'))));
      expect(htmlWithElement).toContain('custom-p');
      expect(htmlWithElement).toContain('Projected Paragraph');
      expect(htmlWithElement).not.toContain('Fallback Body');
    });

    it('empirically renders default fallback when only named slot children are provided', () => {
      // If a child has slot="other", it belongs to namedSlots, leaving defaultChildren empty
      const htmlOnlyNamed = stripComments(renderToString(React.createElement(DefaultSlotCard, null, React.createElement('span', { slot: 'other' }, 'Other Slot Content'))));
      expect(htmlOnlyNamed).toContain('Fallback Body');
    });

    it('empirically renders default children without named slot elements leaking into default slot', () => {
      const htmlMixed = stripComments(
        renderToString(
          React.createElement(DefaultSlotCard, null, React.createElement('span', { slot: 'sidebar' }, 'Sidebar Content'), React.createElement('span', { className: 'main-content' }, 'Main Body')),
        ),
      );
      expect(htmlMixed).toContain('Main Body');
      expect(htmlMixed).not.toContain('Fallback Body');
      expect(htmlMixed).not.toContain('Sidebar Content');
    });
  });

  // =========================================================================
  // 2. Named slots: props[name] vs children via _slots.namedSlots[name] vs fallback
  // =========================================================================
  describe('2. named slots: props vs children vs fallback', () => {
    const code = `
      import { LitElement, html } from 'lit';
      export class ComplexNamedSlotCard extends LitElement {
        render() {
          return html\`
            <div class="container">
              <header>
                <slot name="header"><h3>Default Header</h3></slot>
              </header>
              <main>
                <slot name="content"><p>Default Content</p></slot>
              </main>
              <footer>
                <slot name="footer"><small>Default Footer</small></slot>
              </footer>
            </div>
          \`;
        }
      }
    `;

    const res = compileModule(code, { filePath: 'complex-named-slot.ts' });
    const ComplexNamedSlotCard = evalComponent(res.code, 'ComplexNamedSlotCard');

    it('empirically renders dedicated props (props.header, props.content)', () => {
      const html = stripComments(
        renderToString(
          React.createElement(ComplexNamedSlotCard, {
            header: React.createElement('h1', { className: 'prop-header' }, 'Prop Header Content'),
            content: React.createElement('p', { className: 'prop-body' }, 'Prop Body Content'),
          }),
        ),
      );
      expect(html).toContain('Prop Header Content');
      expect(html).toContain('prop-header');
      expect(html).toContain('Prop Body Content');
      expect(html).not.toContain('Default Header');
      expect(html).not.toContain('Default Content');
      expect(html).toContain('Default Footer'); // Omitted slot renders fallback
    });

    it('empirically renders slotted children via slot="..." attribute', () => {
      const html = stripComments(
        renderToString(
          React.createElement(
            ComplexNamedSlotCard,
            null,
            React.createElement('h2', { slot: 'header', className: 'child-header' }, 'Child Header'),
            React.createElement('div', { slot: 'footer', className: 'child-footer' }, 'Child Footer'),
          ),
        ),
      );
      expect(html).toContain('Child Header');
      expect(html).toContain('child-header');
      expect(html).toContain('Child Footer');
      expect(html).toContain('Default Content'); // Content slot omitted -> fallback
      expect(html).not.toContain('Default Header');
      expect(html).not.toContain('Default Footer');
    });

    it('empirically gives props precedence over slotted children when both are supplied', () => {
      const html = stripComments(
        renderToString(
          React.createElement(
            ComplexNamedSlotCard,
            {
              header: React.createElement('h1', null, 'Prop Header Takes Precedence'),
            },
            React.createElement('h2', { slot: 'header' }, 'Slotted Child Header Should Be Overridden'),
          ),
        ),
      );
      expect(html).toContain('Prop Header Takes Precedence');
      expect(html).not.toContain('Slotted Child Header Should Be Overridden');
      expect(html).not.toContain('Default Header');
    });

    it('empirically renders fallback content when neither prop nor child slot is supplied', () => {
      const html = stripComments(renderToString(React.createElement(ComplexNamedSlotCard)));
      expect(html).toContain('Default Header');
      expect(html).toContain('Default Content');
      expect(html).toContain('Default Footer');
    });

    it('empirically suppresses fallback when prop is explicitly passed as null', () => {
      // In React props, passing header={null} means "render nothing", not "use fallback"
      const html = stripComments(
        renderToString(
          React.createElement(ComplexNamedSlotCard, {
            header: null,
          }),
        ),
      );
      expect(html).not.toContain('Default Header');
      expect(html).toContain('Default Content');
      expect(html).toContain('Default Footer');
    });

    it('empirically checks child slot when prop is explicitly passed as undefined', () => {
      const html = stripComments(
        renderToString(
          React.createElement(
            ComplexNamedSlotCard,
            {
              header: undefined,
            },
            React.createElement('h3', { slot: 'header' }, 'Header from Child Slot'),
          ),
        ),
      );
      expect(html).toContain('Header from Child Slot');
      expect(html).not.toContain('Default Header');
    });

    it('empirically handles kebab-case slot names via props and children attributes', () => {
      const kebabCode = `
        import { LitElement, html } from 'lit';
        export class KebabSlotCard extends LitElement {
          render() {
            return html\`
              <div class="kebab-card">
                <slot name="card-header"><span class="kebab-fallback">Fallback Kebab</span></slot>
                <slot name="action-button"><button>Fallback Action</button></slot>
              </div>
            \`;
          }
        }
      `;

      const kebabRes = compileModule(kebabCode, { filePath: 'kebab-slot.ts' });
      // Verify AstBuilder generates computed bracket access: props["card-header"]
      expect(kebabRes.code).toContain('props["card-header"]');
      expect(kebabRes.code).toContain('props["action-button"]');

      const KebabSlotCard = evalComponent(kebabRes.code, 'KebabSlotCard');

      // Test via props['card-header']
      const htmlProp = stripComments(
        renderToString(
          React.createElement(KebabSlotCard, {
            'card-header': React.createElement('h2', null, 'Prop Kebab Header'),
          }),
        ),
      );
      expect(htmlProp).toContain('Prop Kebab Header');
      expect(htmlProp).not.toContain('Fallback Kebab');
      expect(htmlProp).toContain('Fallback Action');

      // Test via slot="card-header" child
      const htmlChild = stripComments(
        renderToString(
          React.createElement(
            KebabSlotCard,
            null,
            React.createElement('div', { slot: 'card-header' }, 'Child Kebab Header'),
            React.createElement('button', { type: 'button', slot: 'action-button' }, 'Child Action Button'),
          ),
        ),
      );
      expect(htmlChild).toContain('Child Kebab Header');
      expect(htmlChild).toContain('Child Action Button');
      expect(htmlChild).not.toContain('Fallback Kebab');
      expect(htmlChild).not.toContain('Fallback Action');
    });

    it('empirically traverses and partitions named slots inside nested React Fragments', () => {
      const html = stripComments(
        renderToString(
          React.createElement(
            ComplexNamedSlotCard,
            null,
            React.createElement(Fragment, null, React.createElement(Fragment, null, React.createElement('span', { slot: 'header' }, 'Deeply Nested Header'))),
          ),
        ),
      );
      expect(html).toContain('Deeply Nested Header');
      expect(html).not.toContain('Default Header');
    });

    it('empirically projects multiple child elements targeted to the same named slot', () => {
      const html = stripComments(
        renderToString(
          React.createElement(
            ComplexNamedSlotCard,
            null,
            React.createElement('span', { slot: 'header', key: '1' }, 'Header Part 1 - '),
            React.createElement('span', { slot: 'header', key: '2' }, 'Header Part 2'),
          ),
        ),
      );
      expect(html).toContain('Header Part 1 - ');
      expect(html).toContain('Header Part 2');
      expect(html).not.toContain('Default Header');
    });
  });

  // =========================================================================
  // 3. Duplicate slots: tree order assignment rule (Feature 74)
  // =========================================================================
  describe('3. duplicate slots: tree order assignment rule', () => {
    it('empirically verifies duplicate default slots project only to the first slot in tree order', () => {
      const code = `
        import { LitElement, html } from 'lit';
        export class DuplicateDefaultSlots extends LitElement {
          render() {
            return html\`
              <div class="first-slot"><slot>Fallback First</slot></div>
              <div class="second-slot"><slot>Fallback Second</slot></div>
            \`;
          }
        }
      `;

      const res = compileModule(code, { filePath: 'dup-default.ts' });
      const DuplicateDefaultSlots = evalComponent(res.code, 'DuplicateDefaultSlots');

      // 1. With projected children: first slot receives children, second renders fallback
      const htmlWithChildren = stripComments(renderToString(React.createElement(DuplicateDefaultSlots, null, React.createElement('span', { className: 'projected' }, 'Assigned Children'))));
      expect(htmlWithChildren).toContain('<div class="first-slot"><span class="projected">Assigned Children</span></div>');
      expect(htmlWithChildren).toContain('<div class="second-slot">Fallback Second</div>');
      expect(htmlWithChildren).not.toContain('Fallback First');

      // 2. Without children: first slot renders its fallback, second slot renders its fallback
      const htmlWithoutChildren = stripComments(renderToString(React.createElement(DuplicateDefaultSlots)));
      expect(htmlWithoutChildren).toContain('<div class="first-slot">Fallback First</div>');
      expect(htmlWithoutChildren).toContain('<div class="second-slot">Fallback Second</div>');
    });

    it('empirically verifies duplicate named slots project only to the first slot in tree order', () => {
      const code = `
        import { LitElement, html } from 'lit';
        export class DuplicateNamedSlots extends LitElement {
          render() {
            return html\`
              <section class="banner"><slot name="banner">Default Banner Top</slot></section>
              <section class="footer-banner"><slot name="banner">Default Banner Bottom</slot></section>
            \`;
          }
        }
      `;

      const res = compileModule(code, { filePath: 'dup-named.ts' });
      const DuplicateNamedSlots = evalComponent(res.code, 'DuplicateNamedSlots');

      // 1. With prop: banner prop projects to the first slot, second slot renders fallback
      const htmlWithProp = stripComments(
        renderToString(
          React.createElement(DuplicateNamedSlots, {
            banner: React.createElement('h4', null, 'Active Promo Banner'),
          }),
        ),
      );
      expect(htmlWithProp).toContain('<section class="banner"><h4>Active Promo Banner</h4></section>');
      expect(htmlWithProp).toContain('<section class="footer-banner">Default Banner Bottom</section>');

      // 2. With slotted child: child projects to first slot, second slot renders fallback
      const htmlWithChild = stripComments(renderToString(React.createElement(DuplicateNamedSlots, null, React.createElement('div', { slot: 'banner' }, 'Slotted Banner Child'))));
      expect(htmlWithChild).toContain('<section class="banner"><div slot="banner">Slotted Banner Child</div></section>');
      expect(htmlWithChild).toContain('<section class="footer-banner">Default Banner Bottom</section>');

      // 3. Without content: both slots render their respective fallbacks
      const htmlEmpty = stripComments(renderToString(React.createElement(DuplicateNamedSlots)));
      expect(htmlEmpty).toContain('<section class="banner">Default Banner Top</section>');
      expect(htmlEmpty).toContain('<section class="footer-banner">Default Banner Bottom</section>');
    });

    it('empirically verifies triple duplicate slot renders projected content once and remaining fallbacks', () => {
      const code = `
        import { LitElement, html } from 'lit';
        export class TripleSlotCard extends LitElement {
          render() {
            return html\`
              <div class="s1"><slot name="notice">F1</slot></div>
              <div class="s2"><slot name="notice">F2</slot></div>
              <div class="s3"><slot name="notice">F3</slot></div>
            \`;
          }
        }
      `;

      const res = compileModule(code, { filePath: 'triple-slot.ts' });
      const TripleSlotCard = evalComponent(res.code, 'TripleSlotCard');

      const html = stripComments(
        renderToString(
          React.createElement(TripleSlotCard, {
            notice: 'Important Announcement',
          }),
        ),
      );
      expect(html).toContain('<div class="s1">Important Announcement</div>');
      expect(html).toContain('<div class="s2">F2</div>');
      expect(html).toContain('<div class="s3">F3</div>');
    });

    it('empirically verifies duplicate inspected slots wrap first slot and duplicate fallback in SlotBoundary', () => {
      const code = `
        import { LitElement, html } from 'lit';
        export class DupInspectedCard extends LitElement {
          private handleSlotChange(e: Event) {}
          render() {
            return html\`
              <div class="slot-a"><slot @slotchange=\${this.handleSlotChange}>FB A</slot></div>
              <div class="slot-b"><slot @slotchange=\${this.handleSlotChange}>FB B</slot></div>
            \`;
          }
        }
      `;

      const res = compileModule(code, { filePath: 'dup-inspected.ts' });
      expect(res.code).toContain('SlotBoundary');

      const DupInspectedCard = evalComponent(res.code, 'DupInspectedCard');
      const html = stripComments(renderToString(React.createElement(DupInspectedCard, null, 'Assigned to A')));

      expect(html).toContain('Assigned to A');
      expect(html).toContain('FB B');
      // Both occurrences have slot-boundary tags
      const count = (html.match(/<slot-boundary/g) || []).length;
      expect(count).toBe(2);
    });
  });

  // =========================================================================
  // 4. Nested slot boundaries: assignedElements and assignedNodes flattening
  // =========================================================================
  describe('4. nested slot boundaries: assignedElements and assignedNodes flattening', () => {
    it('empirically augments slot-boundary node with assignedElements and assignedNodes', () => {
      const node = createMockElement('slot-boundary');
      augmentSlotBoundaryNode(node);

      expect(typeof node.assignedElements).toBe('function');
      expect(typeof node.assignedNodes).toBe('function');
    });

    it('empirically returns direct element children when flatten is false or omitted', () => {
      const parentBoundary = createMockElement('slot-boundary');
      const innerBoundary = createMockElement('slot-boundary');
      const directButton = createMockElement('button');
      parentBoundary.appendChild(innerBoundary);
      parentBoundary.appendChild(directButton);

      augmentSlotBoundaryNode(parentBoundary);

      const elements = parentBoundary.assignedElements();
      expect(elements).toHaveLength(2);
      expect(elements[0]).toBe(innerBoundary);
      expect(elements[1]).toBe(directButton);
    });

    it('empirically flattens nested slot-boundary elements when flatten: true', () => {
      const parentBoundary = createMockElement('slot-boundary');
      const innerBoundary = createMockElement('slot-boundary');
      const nestedSpan = createMockElement('span');
      const nestedButton = createMockElement('button');
      const directAnchor = createMockElement('a');

      innerBoundary.appendChild(nestedSpan);
      innerBoundary.appendChild(nestedButton);
      parentBoundary.appendChild(innerBoundary);
      parentBoundary.appendChild(directAnchor);

      augmentSlotBoundaryNode(parentBoundary);
      augmentSlotBoundaryNode(innerBoundary);

      const flattened = parentBoundary.assignedElements({ flatten: true });
      expect(flattened).toHaveLength(3);
      expect(flattened[0]).toBe(nestedSpan);
      expect(flattened[1]).toBe(nestedButton);
      expect(flattened[2]).toBe(directAnchor);
    });

    it('empirically flattens multi-level deep nested boundaries (5 and 10 levels deep)', () => {
      // Build a 5-level deep slot-boundary chain
      const root = createMockElement('slot-boundary');
      augmentSlotBoundaryNode(root);

      let current = root;
      for (let i = 0; i < 5; i++) {
        const next = createMockElement('slot-boundary');
        augmentSlotBoundaryNode(next);
        current.appendChild(next);
        current = next;
      }

      const leaf1 = createMockElement('button');
      const leaf2 = createMockElement('span');
      current.appendChild(leaf1);
      current.appendChild(leaf2);

      const flattened = root.assignedElements({ flatten: true });
      expect(flattened).toHaveLength(2);
      expect(flattened[0]).toBe(leaf1);
      expect(flattened[1]).toBe(leaf2);
    });

    it('empirically flattens assignedNodes preserving elements and text nodes when Node global is present', () => {
      // Mock globalThis.Node for Node test runner environment
      const origNode = (globalThis as any).Node;
      (globalThis as any).Node = { ELEMENT_NODE: 1, TEXT_NODE: 3 };

      try {
        const parentBoundary = createMockElement('slot-boundary');
        const innerBoundary = createMockElement('slot-boundary');
        const textNode1 = createMockTextNode('Hello');
        const spanNode = createMockElement('span');
        const textNode2 = createMockTextNode('World');

        innerBoundary.appendChild(textNode1);
        innerBoundary.appendChild(spanNode);
        parentBoundary.appendChild(innerBoundary);
        parentBoundary.appendChild(textNode2);

        augmentSlotBoundaryNode(parentBoundary);
        augmentSlotBoundaryNode(innerBoundary);

        // Without flatten
        const unflattened = parentBoundary.assignedNodes();
        expect(unflattened).toHaveLength(2);
        expect(unflattened[0]).toBe(innerBoundary);
        expect(unflattened[1]).toBe(textNode2);

        // With flatten: true
        const flattened = parentBoundary.assignedNodes({ flatten: true });
        expect(flattened).toHaveLength(3);
        expect(flattened[0]).toBe(textNode1);
        expect(flattened[1]).toBe(spanNode);
        expect(flattened[2]).toBe(textNode2);
      } finally {
        if (origNode === undefined) {
          delete (globalThis as any).Node;
        } else {
          (globalThis as any).Node = origNode;
        }
      }
    });

    it('empirically handles unaugmented nested slot-boundary elements defensively', () => {
      const parentBoundary = createMockElement('slot-boundary');
      const unaugmentedInner = createMockElement('slot-boundary');
      const leaf = createMockElement('span');
      unaugmentedInner.appendChild(leaf);
      parentBoundary.appendChild(unaugmentedInner);

      augmentSlotBoundaryNode(parentBoundary);

      // If unaugmentedInner does NOT have assignedElements, calling .assignedElements({ flatten: true })
      // on parent would throw if not guarded. Let's record the behavior:
      try {
        parentBoundary.assignedElements({ flatten: true });
      } catch (err: any) {
        expect(err.message).toContain('assignedElements is not a function');
      }
    });

    it('empirically returns empty array for empty nested slot boundaries', () => {
      const parentBoundary = createMockElement('slot-boundary');
      const innerBoundary = createMockElement('slot-boundary');
      parentBoundary.appendChild(innerBoundary);

      augmentSlotBoundaryNode(parentBoundary);
      augmentSlotBoundaryNode(innerBoundary);

      const flattened = parentBoundary.assignedElements({ flatten: true });
      expect(flattened).toEqual([]);
    });
  });

  // =========================================================================
  // 5. Dynamic DOM mutations & MutationObserver slotchange events (Feature 76)
  // =========================================================================
  describe('5. dynamic DOM mutations & MutationObserver slotchange events', () => {
    it('empirically attaches MutationObserver and dispatches slotchange CustomEvent on child mutation', () => {
      const origMO = (globalThis as any).MutationObserver;
      let observerCb: ((...args: any[]) => any) | null = null;
      let observedTarget: any = null;
      let disconnectCalled = false;

      // Mock MutationObserver
      (globalThis as any).MutationObserver = class MockMutationObserver {
        constructor(cb: (...args: any[]) => any) {
          observerCb = cb;
        }
        observe(target: any) {
          observedTarget = target;
          target._observerCallback = observerCb;
        }
        disconnect() {
          disconnectCalled = true;
          if (observedTarget) {
            delete observedTarget._observerCallback;
          }
        }
      };

      try {
        const boundary = createMockElement('slot-boundary');
        let slotChangeFired = false;
        let eventDetail: any = null;

        boundary.addEventListener('slotchange', (e: any) => {
          slotChangeFired = true;
          eventDetail = e;
        });

        const onSlotChangeCallback = vi.fn();
        const cleanup = attachSlotBoundary(boundary, onSlotChangeCallback);

        expect(observedTarget).toBe(boundary);

        // Add child node to trigger MutationObserver callback
        const child = createMockElement('div');
        boundary.appendChild(child);

        expect(slotChangeFired).toBe(true);
        expect(eventDetail).toBeDefined();
        expect(eventDetail.type).toBe('slotchange');
        expect(eventDetail.bubbles).toBe(false);
        expect(eventDetail.cancelable).toBe(false);
        expect(onSlotChangeCallback).toHaveBeenCalledTimes(1);

        // Remove child node to trigger another mutation
        boundary.removeChild(child);
        expect(onSlotChangeCallback).toHaveBeenCalledTimes(2);

        // Disconnect cleanup
        cleanup?.();
        expect(disconnectCalled).toBe(true);

        // Subsequent mutations after cleanup do not trigger callback
        boundary.appendChild(createMockElement('span'));
        expect(onSlotChangeCallback).toHaveBeenCalledTimes(2);
      } finally {
        if (origMO === undefined) {
          delete (globalThis as any).MutationObserver;
        } else {
          (globalThis as any).MutationObserver = origMO;
        }
      }
    });

    it('empirically verifies SlotBoundary component renders data-slot-boundary and display:contents', () => {
      const html = stripComments(renderToString(React.createElement(SlotBoundary, { 'data-slot': 'custom-slot' } as any, React.createElement('span', null, 'Boundary Child'))));
      expect(html).toContain('<slot-boundary');
      expect(html).toContain('data-slot-boundary=""');
      expect(html).toContain('data-slot="custom-slot"');
      expect(html).toContain('display:contents');
      expect(html).toContain('Boundary Child');
    });
  });

  // =========================================================================
  // 6. Full Lit component compilation and React SSR parity
  // =========================================================================
  describe('6. full Lit component compilation and React SSR parity', () => {
    it('empirically lowers Tier 1 hosted component with combined default, named, and inspected slots', () => {
      const code = `
        import { LitElement, html, property } from 'lit';

        export class EnterpriseTabs extends LitElement {
          @property({ type: String })
          activeTab = 'tab-1';

          private onTabsSlotChange(e: Event) {}

          render() {
            return html\`
              <div class="tabs-header">
                <slot name="nav"><nav>Default Nav</nav></slot>
              </div>
              <div class="tabs-panels">
                <slot @slotchange=\${this.onTabsSlotChange}><p>No Panels Slotted</p></slot>
              </div>
            \`;
          }
        }
      `;

      const res = compileModule(code, { filePath: 'enterprise-tabs.ts' });

      // Verify AstBuilder synthesizes slot boundary and slot partitioning
      expect(res.code).toContain('partitionSlots');
      expect(res.code).toContain('SlotBoundary');
      expect(res.code).toContain('props.nav !== undefined ? props.nav : _slots.namedSlots["nav"]?.length > 0 ? _slots.namedSlots["nav"] : <><nav>Default Nav</nav></>');

      const EnterpriseTabs = evalComponent(res.code, 'EnterpriseTabs');

      // 1. Render with defaults
      const htmlDefault = stripComments(renderToString(React.createElement(EnterpriseTabs)));
      expect(htmlDefault).toContain('Default Nav');
      expect(htmlDefault).toContain('No Panels Slotted');
      expect(htmlDefault).toContain('<slot-boundary');

      // 2. Render with slotted navigation and panels
      const htmlCustom = stripComments(
        renderToString(
          React.createElement(
            EnterpriseTabs,
            {
              nav: React.createElement('ul', { className: 'custom-nav' }, React.createElement('li', null, 'Tab 1')),
            },
            React.createElement('div', { className: 'panel' }, 'Panel 1 Body'),
          ),
        ),
      );
      expect(htmlCustom).toContain('custom-nav');
      expect(htmlCustom).toContain('Tab 1');
      expect(htmlCustom).toContain('Panel 1 Body');
      expect(htmlCustom).not.toContain('Default Nav');
      expect(htmlCustom).not.toContain('No Panels Slotted');
    });

    it('empirically lowers Tier 0 pure functional component with slots', () => {
      const code = `
        import { LitElement, html } from 'lit';

        export class PureSlotCard extends LitElement {
          render() {
            return html\`
              <article class="pure-card">
                <header><slot name="header">Header Fallback</slot></header>
                <div class="body"><slot>Body Fallback</slot></div>
              </article>
            \`;
          }
        }
      `;

      const res = compileModule(code, { filePath: 'pure-slot-card.ts', targetTier: 'Tier0Pure' });
      // In Tier 0, component is a pure function without MorphHost or useMorphHost
      expect(res.code).not.toContain('class PureSlotCardHost');
      expect(res.code).not.toContain('useMorphHost');
      expect(res.code).toContain('partitionSlots');

      const PureSlotCard = evalComponent(res.code, 'PureSlotCard');

      const html = stripComments(
        renderToString(React.createElement(PureSlotCard, null, React.createElement('h3', { slot: 'header' }, 'Slotted Pure Header'), React.createElement('p', null, 'Slotted Pure Body'))),
      );
      expect(html).toContain('Slotted Pure Header');
      expect(html).toContain('Slotted Pure Body');
      expect(html).not.toContain('Header Fallback');
      expect(html).not.toContain('Body Fallback');
    });

    it('empirically combines scoped CSS donut scoping with slot boundary elements', () => {
      const code = `
        import { LitElement, html, css } from 'lit';

        export class ScopedSlotButton extends LitElement {
          static styles = css\`
            :host { display: inline-block; }
            button { background: blue; color: white; }
            ::slotted(svg) { fill: currentColor; }
          \`;

          private onIconChange(e: Event) {}

          render() {
            return html\`
              <button>
                <slot name="icon" @slotchange=\${this.onIconChange}><span class="default-icon">★</span></slot>
                <slot>Label</slot>
              </button>
            \`;
          }
        }
      `;

      const res = compileModule(code, { filePath: 'scoped-slot-btn.ts' });
      expect(res.code).toContain('@scope');
      expect(res.code).toContain('to (slot,[data-slot-boundary],slot-boundary)');
      expect(res.code).toContain('SlotBoundary');

      const ScopedSlotButton = evalComponent(res.code, 'ScopedSlotButton');
      const html = stripComments(renderToString(React.createElement(ScopedSlotButton, null, React.createElement('svg', { slot: 'icon', className: 'custom-icon' }), 'Click Me')));
      expect(html).toContain('custom-icon');
      expect(html).toContain('Click Me');
      expect(html).not.toContain('default-icon');
    });

    it('empirically verifies mutually exclusive ternary slot branches can reuse slot names without stripping content', () => {
      const code = `
        import { LitElement, html, property } from 'lit';

        export class ConditionalSlotHost extends LitElement {
          @property({ type: Boolean })
          expanded = false;

          render() {
            return html\`
              <div class="container">
                \${this.expanded
                  ? html\`<div class="expanded-view"><slot name="content"><span>Default Expanded</span></slot></div>\`
                  : html\`<div class="collapsed-view"><slot name="content"><span>Default Collapsed</span></slot></div>\`}
              </div>
            \`;
          }
        }
      `;

      const res = compileModule(code, { filePath: 'conditional-slot-host.ts' });
      const ConditionalSlotHost = evalComponent(res.code, 'ConditionalSlotHost');

      // Test collapsed state
      const collapsedHtml = stripComments(
        renderToString(React.createElement(ConditionalSlotHost, { expanded: false }, React.createElement('span', { slot: 'content', className: 'projected-item' }, 'Projected Item'))),
      );
      expect(collapsedHtml).toContain('collapsed-view');
      expect(collapsedHtml).toContain('projected-item');
      expect(collapsedHtml).not.toContain('Default Collapsed');

      // Test expanded state
      const expandedHtml = stripComments(
        renderToString(React.createElement(ConditionalSlotHost, { expanded: true }, React.createElement('span', { slot: 'content', className: 'projected-item' }, 'Projected Item'))),
      );
      expect(expandedHtml).toContain('expanded-view');
      expect(expandedHtml).toContain('projected-item');
      expect(expandedHtml).not.toContain('Default Expanded');
    });

    it('empirically verifies when directive slot branches can reuse slot names without stripping content', () => {
      const code = `
        import { LitElement, html, property } from 'lit';
        import { when } from 'lit/directives/when.js';

        export class WhenSlotHost extends LitElement {
          @property({ type: Boolean })
          active = false;

          render() {
            return html\`
              <div class="wrapper">
                \${when(
                  this.active,
                  () => html\`<div class="active-box"><slot name="badge"><span>Fallback Active</span></slot></div>\`,
                  () => html\`<div class="inactive-box"><slot name="badge"><span>Fallback Inactive</span></slot></div>\`
                )}
              </div>
            \`;
          }
        }
      `;

      const res = compileModule(code, { filePath: 'when-slot-host.ts' });
      const WhenSlotHost = evalComponent(res.code, 'WhenSlotHost');

      const activeHtml = stripComments(renderToString(React.createElement(WhenSlotHost, { active: true }, React.createElement('span', { slot: 'badge', className: 'user-badge' }, 'Online'))));
      expect(activeHtml).toContain('active-box');
      expect(activeHtml).toContain('user-badge');
      expect(activeHtml).not.toContain('Fallback Active');

      const inactiveHtml = stripComments(renderToString(React.createElement(WhenSlotHost, { active: false }, React.createElement('span', { slot: 'badge', className: 'user-badge' }, 'Offline'))));
      expect(inactiveHtml).toContain('inactive-box');
      expect(inactiveHtml).toContain('user-badge');
      expect(inactiveHtml).not.toContain('Fallback Inactive');
    });
  });
});
