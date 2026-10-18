import React from 'react';
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

type EventCallback = (...args: any[]) => void;

/**
 * Mock DOM element hierarchy for testing slot boundary inspection and MutationObserver
 */
function createMockElement(tagName: string, children: any[] = []): any {
  const listeners: Record<string, EventCallback[]> = {};
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
    addEventListener(event: string, cb: EventCallback) {
      if (!listeners[event]) listeners[event] = [];
      listeners[event].push(cb);
    },
    removeEventListener(event: string, cb: EventCallback) {
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

describe('milestone 5 wave 2 challenger: adversarial slot branch & boundary stress testing', () => {
  // =========================================================================
  // 1. Conditional slot branches (ternary, when, choose)
  // =========================================================================
  describe('1. conditional slot branches (ternary, when, choose)', () => {
    it('empirically verifies multi-way choose directive branches all isolate and project named slots', () => {
      const code = `
        import { LitElement, html, property } from 'lit';
        import { choose } from 'lit/directives/choose.js';

        export class MultiWayChooseHost extends LitElement {
          @property({ type: String })
          status = 'idle';

          render() {
            return html\`
              <div class="status-panel">
                \${choose(
                  this.status,
                  [
                    ['idle', () => html\`<div class="idle-state"><slot name="badge"><span>Default Idle</span></slot></div>\`],
                    ['busy', () => html\`<div class="busy-state"><slot name="badge"><span>Default Busy</span></slot></div>\`],
                    ['done', () => html\`<div class="done-state"><slot name="badge"><span>Default Done</span></slot></div>\`],
                  ],
                  () => html\`<div class="unknown-state"><slot name="badge"><span>Default Unknown</span></slot></div>\`
                )}
              </div>
            \`;
          }
        }
      `;

      const res = compileModule(code, { filePath: 'multi-way-choose.ts' });
      expect(res.code).toContain('partitionSlots');
      const MultiWayChooseHost = evalComponent(res.code, 'MultiWayChooseHost');

      // Test each branch with projected slot content
      for (const s of ['idle', 'busy', 'done', 'other']) {
        const expectedClass = s === 'other' ? 'unknown-state' : `${s}-state`;
        const rendered = stripComments(
          renderToString(React.createElement(MultiWayChooseHost, { status: s }, React.createElement('span', { slot: 'badge', className: 'projected-badge' }, `Active Status: ${s}`))),
        );
        expect(rendered).toContain(expectedClass);
        expect(rendered).toContain('projected-badge');
        expect(rendered).toContain(`Active Status: ${s}`);
        expect(rendered).not.toContain('Default');
      }

      // Test each branch with fallback content (no projected children)
      const idleFallback = stripComments(renderToString(React.createElement(MultiWayChooseHost, { status: 'idle' })));
      expect(idleFallback).toContain('idle-state');
      expect(idleFallback).toContain('Default Idle');

      const busyFallback = stripComments(renderToString(React.createElement(MultiWayChooseHost, { status: 'busy' })));
      expect(busyFallback).toContain('busy-state');
      expect(busyFallback).toContain('Default Busy');

      const doneFallback = stripComments(renderToString(React.createElement(MultiWayChooseHost, { status: 'done' })));
      expect(doneFallback).toContain('done-state');
      expect(doneFallback).toContain('Default Done');

      const unknownFallback = stripComments(renderToString(React.createElement(MultiWayChooseHost, { status: 'unknown' })));
      expect(unknownFallback).toContain('unknown-state');
      expect(unknownFallback).toContain('Default Unknown');
    });

    it('empirically verifies default slots inside conditional branches project children or fallback accurately', () => {
      const code = `
        import { LitElement, html, property } from 'lit';

        export class ConditionalDefaultSlotHost extends LitElement {
          @property({ type: Boolean })
          alternate = false;

          render() {
            return html\`
              <div class="view-shell">
                \${this.alternate
                  ? html\`<div class="alt-view"><slot><span>Default Alternate Content</span></slot></div>\`
                  : html\`<div class="primary-view"><slot><span>Default Primary Content</span></slot></div>\`}
              </div>
            \`;
          }
        }
      `;

      const res = compileModule(code, { filePath: 'cond-default-slot.ts' });
      const ConditionalDefaultSlotHost = evalComponent(res.code, 'ConditionalDefaultSlotHost');

      // Primary view with child
      const primChild = stripComments(renderToString(React.createElement(ConditionalDefaultSlotHost, { alternate: false }, React.createElement('p', null, 'Hello World'))));
      expect(primChild).toContain('primary-view');
      expect(primChild).toContain('<p>Hello World</p>');
      expect(primChild).not.toContain('Default Primary Content');

      // Alt view with child
      const altChild = stripComments(renderToString(React.createElement(ConditionalDefaultSlotHost, { alternate: true }, React.createElement('p', null, 'Hello World'))));
      expect(altChild).toContain('alt-view');
      expect(altChild).toContain('<p>Hello World</p>');
      expect(altChild).not.toContain('Default Alternate Content');

      // Primary fallback
      const primFb = stripComments(renderToString(React.createElement(ConditionalDefaultSlotHost, { alternate: false })));
      expect(primFb).toContain('primary-view');
      expect(primFb).toContain('Default Primary Content');

      // Alt fallback
      const altFb = stripComments(renderToString(React.createElement(ConditionalDefaultSlotHost, { alternate: true })));
      expect(altFb).toContain('alt-view');
      expect(altFb).toContain('Default Alternate Content');
    });

    it('empirically verifies multiple distinct named slots alternating across conditional branches', () => {
      const code = `
        import { LitElement, html, property } from 'lit';

        export class AlternatingNamedSlotsHost extends LitElement {
          @property({ type: String })
          layout = 'left';

          render() {
            return html\`
              <div class="split-layout">
                \${this.layout === 'left'
                  ? html\`<div class="left-pane"><slot name="left">Left Fallback</slot></div>\`
                  : html\`<div class="right-pane"><slot name="right">Right Fallback</slot></div>\`}
              </div>
            \`;
          }
        }
      `;

      const res = compileModule(code, { filePath: 'alternating-named-slots.ts' });
      expect(res.code).toContain('partitionSlots');
      const AlternatingNamedSlotsHost = evalComponent(res.code, 'AlternatingNamedSlotsHost');

      const renderedLeft = stripComments(
        renderToString(
          React.createElement(
            AlternatingNamedSlotsHost,
            { layout: 'left' },
            React.createElement('div', { slot: 'left', className: 'left-content' }, 'Left Custom'),
            React.createElement('div', { slot: 'right', className: 'right-content' }, 'Right Custom'),
          ),
        ),
      );
      expect(renderedLeft).toContain('left-pane');
      expect(renderedLeft).toContain('left-content');
      expect(renderedLeft).not.toContain('right-pane');
      expect(renderedLeft).not.toContain('right-content');

      const renderedRight = stripComments(
        renderToString(
          React.createElement(
            AlternatingNamedSlotsHost,
            { layout: 'right' },
            React.createElement('div', { slot: 'left', className: 'left-content' }, 'Left Custom'),
            React.createElement('div', { slot: 'right', className: 'right-content' }, 'Right Custom'),
          ),
        ),
      );
      expect(renderedRight).toContain('right-pane');
      expect(renderedRight).toContain('right-content');
      expect(renderedRight).not.toContain('left-pane');
      expect(renderedRight).not.toContain('left-content');
    });
  });

  // =========================================================================
  // 2. Exhaustive conditional slot branch vs post-conditional duplicate slot
  // =========================================================================
  describe('2. exhaustive conditional slot branch vs post-conditional duplicate slot', () => {
    it('empirically verifies post-conditional slot renders fallback when slot was already rendered in exhaustive branches', () => {
      const code = `
        import { LitElement, html, property } from 'lit';

        export class ExhaustiveBranchWithPostDuplicateHost extends LitElement {
          @property({ type: Boolean })
          expanded = false;

          render() {
            return html\`
              <div class="wrapper">
                <header>
                  \${this.expanded
                    ? html\`<div class="expanded-hdr"><slot name="action"><span>Action Fallback Exp</span></slot></div>\`
                    : html\`<div class="collapsed-hdr"><slot name="action"><span>Action Fallback Col</span></slot></div>\`}
                </header>
                <footer>
                  <!-- This duplicate slot should render fallback because slot was already assigned in tree order -->
                  <div class="footer-slot"><slot name="action"><span>Action Footer Fallback</span></slot></div>
                </footer>
              </div>
            \`;
          }
        }
      `;

      const res = compileModule(code, { filePath: 'exhaustive-post-dup.ts' });
      const ExhaustiveBranchWithPostDuplicateHost = evalComponent(res.code, 'ExhaustiveBranchWithPostDuplicateHost');

      // With projected slot content:
      // In collapsed state: collapsed-hdr gets projected content; footer gets fallback
      const colHtml = stripComments(
        renderToString(
          React.createElement(ExhaustiveBranchWithPostDuplicateHost, { expanded: false }, React.createElement('button', { type: 'button', slot: 'action', className: 'my-btn' }, 'Submit Action')),
        ),
      );
      expect(colHtml).toContain('collapsed-hdr');
      expect(colHtml).toContain('my-btn');
      expect(colHtml).toContain('footer-slot');
      expect(colHtml).toContain('Action Footer Fallback');

      // In expanded state: expanded-hdr gets projected content; footer gets fallback
      const expHtml = stripComments(
        renderToString(
          React.createElement(ExhaustiveBranchWithPostDuplicateHost, { expanded: true }, React.createElement('button', { type: 'button', slot: 'action', className: 'my-btn' }, 'Submit Action')),
        ),
      );
      expect(expHtml).toContain('expanded-hdr');
      expect(expHtml).toContain('my-btn');
      expect(expHtml).toContain('footer-slot');
      expect(expHtml).toContain('Action Footer Fallback');
    });

    it('empirically verifies sequential non-conditional duplicate slots in tree order within same template', () => {
      const code = `
        import { LitElement, html } from 'lit';

        export class SequentialDuplicatesHost extends LitElement {
          render() {
            return html\`
              <div class="dup-test">
                <div class="slot-1"><slot name="badge"><span>Badge FB 1</span></slot></div>
                <div class="slot-2"><slot name="badge"><span>Badge FB 2</span></slot></div>
                <div class="slot-3"><slot name="badge"><span>Badge FB 3</span></slot></div>
              </div>
            \`;
          }
        }
      `;

      const res = compileModule(code, { filePath: 'seq-dups.ts' });
      const SequentialDuplicatesHost = evalComponent(res.code, 'SequentialDuplicatesHost');

      const html = stripComments(renderToString(React.createElement(SequentialDuplicatesHost, null, React.createElement('span', { slot: 'badge', className: 'live-badge' }, 'V2 Live'))));

      // Only slot 1 receives projected child
      expect(html).toContain('slot-1');
      expect(html).toContain('live-badge');
      expect(html).not.toContain('Badge FB 1');

      // Slots 2 and 3 receive fallbacks
      expect(html).toContain('slot-2');
      expect(html).toContain('Badge FB 2');
      expect(html).toContain('slot-3');
      expect(html).toContain('Badge FB 3');
    });
  });

  // =========================================================================
  // 3. Slot boundary flattening & MutationObserver edge cases
  // =========================================================================
  describe('3. slot boundary flattening & MutationObserver edge cases', () => {
    it('empirically flattens deeply nested mixed boundaries with element and text nodes across 10 levels', () => {
      const leafElement = createMockElement('span');
      leafElement.className = 'leaf-target';
      const leafText = createMockTextNode('leaf-content');

      let currentInner = createMockElement('slot-boundary', [leafElement, leafText]);
      augmentSlotBoundaryNode(currentInner);

      for (let level = 8; level >= 0; level--) {
        const outer = createMockElement('slot-boundary', [createMockTextNode(`level-${level}-text `), createMockElement('div'), currentInner]);
        augmentSlotBoundaryNode(outer);
        currentInner = outer;
      }

      const rootBoundary = currentInner;

      // Unflattened assignedElements: only direct element children (the div and child slot-boundary)
      const directElements = rootBoundary.assignedElements({ flatten: false });
      expect(directElements.length).toBe(2);
      expect(directElements[0].tagName).toBe('DIV');
      expect(directElements[1].tagName).toBe('SLOT-BOUNDARY');

      // Flattened assignedElements: should traverse all 10 levels and return the 9 intermediate divs + 1 leaf span
      const flattenedElements = rootBoundary.assignedElements({ flatten: true });
      expect(flattenedElements.length).toBe(10);
      expect(flattenedElements[9].className).toBe('leaf-target');

      // Flattened assignedNodes: should return 9 intermediate text nodes + 9 divs + 1 leaf span + 1 leaf text = 20 nodes
      const flattenedNodes = rootBoundary.assignedNodes({ flatten: true });
      expect(flattenedNodes.length).toBe(20);
      expect(flattenedNodes[flattenedNodes.length - 1].textContent).toBe('leaf-content');
    });

    it('empirically demonstrates that unaugmented nested slot-boundary elements cause assignedElements to throw', () => {
      const unaugmentedInner = createMockElement('slot-boundary', [createMockElement('p')]);
      const outer = createMockElement('slot-boundary', [unaugmentedInner]);
      augmentSlotBoundaryNode(outer);

      // Demonstrates Defect: unaugmented inner boundary lacks assignedElements method, throwing TypeError
      expect(() => {
        outer.assignedElements({ flatten: true });
      }).toThrow(/assignedElements is not a function/);
    });

    it('empirically verifies rapid sequential DOM mutations dispatch corresponding slotchange CustomEvents', () => {
      const boundary = createMockElement('slot-boundary');
      const receivedEvents: any[] = [];
      const onSlotChange = vi.fn((e) => receivedEvents.push(e));

      const originalMO = (globalThis as any).MutationObserver;
      try {
        (globalThis as any).MutationObserver = class MockMutationObserver {
          callback: EventCallback;
          constructor(cb: EventCallback) {
            this.callback = cb;
          }
          observe(target: any) {
            target._observerCallback = this.callback;
          }
          disconnect() {}
        };

        const cleanup = attachSlotBoundary(boundary, onSlotChange);
        expect(cleanup).toBeDefined();

        // 1. Add child
        const child1 = createMockElement('span');
        boundary.appendChild(child1);
        expect(onSlotChange).toHaveBeenCalledTimes(1);
        expect(receivedEvents[0].type).toBe('slotchange');
        expect(receivedEvents[0].bubbles).toBe(false);
        expect(receivedEvents[0].cancelable).toBe(false);

        // 2. Add second child
        const child2 = createMockElement('div');
        boundary.appendChild(child2);
        expect(onSlotChange).toHaveBeenCalledTimes(2);

        // 3. Remove child
        boundary.removeChild(child1);
        expect(onSlotChange).toHaveBeenCalledTimes(3);

        // 4. Disconnect and verify no more events dispatched
        cleanup?.();
        boundary._observerCallback = null;
        boundary.appendChild(createMockElement('p'));
        expect(onSlotChange).toHaveBeenCalledTimes(3);
      } finally {
        (globalThis as any).MutationObserver = originalMO;
      }
    });

    it('empirically verifies SlotBoundary supports both onSlotChange and onSlotchange prop casings', () => {
      const fnCamel = vi.fn();
      const fnLower = vi.fn();

      const elCamel = React.createElement(SlotBoundary, { onSlotChange: fnCamel }, 'Child 1');
      const htmlCamel = renderToString(elCamel);
      expect(htmlCamel).toContain('data-slot-boundary');
      expect(htmlCamel).toContain('display:contents');

      const elLower = React.createElement(SlotBoundary, { onSlotchange: fnLower }, 'Child 2');
      const htmlLower = renderToString(elLower);
      expect(htmlLower).toContain('data-slot-boundary');
      expect(htmlLower).toContain('display:contents');
    });
  });

  // =========================================================================
  // 4. Empirical adversarial branch and boundary verification
  // =========================================================================
  describe('4. empirical adversarial branch and boundary verification', () => {
    it('empirically verifies parenthesized ternary branches lower to JSX and render properly', () => {
      const code = `
        import { LitElement, html, property } from 'lit';

        export class ParenTernaryHost extends LitElement {
          @property({ type: Boolean })
          cond = false;

          render() {
            return html\`
              <div>
                \${this.cond
                  ? (html\`<div class="branch-a"><slot name="content"><span>Default A</span></slot></div>\`)
                  : (html\`<div class="branch-b"><slot name="content"><span>Default B</span></slot></div>\`)}
              </div>
            \`;
          }
        }
      `;

      const res = compileModule(code, { filePath: 'paren-ternary.ts' });
      expect(res.code).not.toContain('html`<div class="branch-a">');
      expect(res.code).not.toContain('html`<div class="branch-b">');

      const ParenTernaryHost = evalComponent(res.code, 'ParenTernaryHost');

      // Branch A with projected content
      const htmlA = stripComments(renderToString(React.createElement(ParenTernaryHost, { cond: true }, React.createElement('span', { slot: 'content' }, 'Custom Content A'))));
      expect(htmlA).toContain('branch-a');
      expect(htmlA).toContain('Custom Content A');
      expect(htmlA).not.toContain('Default A');

      // Branch B with fallback
      const htmlB = stripComments(renderToString(React.createElement(ParenTernaryHost, { cond: false })));
      expect(htmlB).toContain('branch-b');
      expect(htmlB).toContain('Default B');
    });

    it('empirically verifies nested ternary conditionals lower all inner template branches to JSX', () => {
      const code = `
        import { LitElement, html, property } from 'lit';

        export class NestedTernaryHost extends LitElement {
          @property({ type: Boolean })
          cond1 = false;

          @property({ type: Boolean })
          cond2 = false;

          render() {
            return html\`
              <div class="nested-box">
                \${this.cond1
                  ? (this.cond2
                      ? html\`<div class="path-tt"><slot name="tag"><span>Default TT</span></slot></div>\`
                      : html\`<div class="path-tf"><slot name="tag"><span>Default TF</span></slot></div>\`)
                  : (this.cond2
                      ? html\`<div class="path-ft"><slot name="tag"><span>Default FT</span></slot></div>\`
                      : html\`<div class="path-ff"><slot name="tag"><span>Default FF</span></slot></div>\`)}
              </div>
            \`;
          }
        }
      `;

      const res = compileModule(code, { filePath: 'nested-ternary.ts' });
      expect(res.code).not.toContain('html`<div class="path-tt">');
      expect(res.code).not.toContain('html`<div class="path-tf">');
      expect(res.code).not.toContain('html`<div class="path-ft">');
      expect(res.code).not.toContain('html`<div class="path-ff">');

      const NestedTernaryHost = evalComponent(res.code, 'NestedTernaryHost');

      // Test all 4 leaf paths with projected slot content
      const cases = [
        { cond1: true, cond2: true, expectedClass: 'path-tt', label: 'Custom TT' },
        { cond1: true, cond2: false, expectedClass: 'path-tf', label: 'Custom TF' },
        { cond1: false, cond2: true, expectedClass: 'path-ft', label: 'Custom FT' },
        { cond1: false, cond2: false, expectedClass: 'path-ff', label: 'Custom FF' },
      ];

      for (const c of cases) {
        const rendered = stripComments(renderToString(React.createElement(NestedTernaryHost, { cond1: c.cond1, cond2: c.cond2 }, React.createElement('span', { slot: 'tag' }, c.label))));
        expect(rendered).toContain(c.expectedClass);
        expect(rendered).toContain(c.label);
        expect(rendered).not.toContain('Default');
      }
    });

    it('empirically verifies when directives with nested ternary branches lower to JSX', () => {
      const code = `
        import { LitElement, html, property } from 'lit';
        import { when } from 'lit/directives/when.js';

        export class WhenTernaryHost extends LitElement {
          @property({ type: Boolean })
          flagA = false;

          @property({ type: Boolean })
          flagB = false;

          render() {
            return html\`
              <div class="hybrid-container">
                \${when(
                  this.flagA,
                  () => (this.flagB
                    ? html\`<section class="branch-a-true"><slot name="info"><span>Fallback A-True</span></slot></section>\`
                    : html\`<section class="branch-a-false"><slot name="info"><span>Fallback A-False</span></slot></section>\`),
                  () => html\`<section class="branch-b"><slot name="info"><span>Fallback B</span></slot></section>\`
                )}
              </div>
            \`;
          }
        }
      `;

      const res = compileModule(code, { filePath: 'when-ternary.ts' });
      expect(res.code).not.toContain('html`<section class="branch-a-true">');
      expect(res.code).not.toContain('html`<section class="branch-a-false">');
      expect(res.code).not.toContain('html`<section class="branch-b">');

      const WhenTernaryHost = evalComponent(res.code, 'WhenTernaryHost');

      // Branch A-True
      const htmlATrue = stripComments(renderToString(React.createElement(WhenTernaryHost, { flagA: true, flagB: true }, React.createElement('span', { slot: 'info' }, 'Custom Info A-True'))));
      expect(htmlATrue).toContain('branch-a-true');
      expect(htmlATrue).toContain('Custom Info A-True');
      expect(htmlATrue).not.toContain('Fallback A-True');

      // Branch A-False
      const htmlAFalse = stripComments(renderToString(React.createElement(WhenTernaryHost, { flagA: true, flagB: false })));
      expect(htmlAFalse).toContain('branch-a-false');
      expect(htmlAFalse).toContain('Fallback A-False');

      // Branch B
      const htmlB = stripComments(renderToString(React.createElement(WhenTernaryHost, { flagA: false, flagB: true })));
      expect(htmlB).toContain('branch-b');
      expect(htmlB).toContain('Fallback B');
    });

    it('empirically verifies sub-templates in class helper methods lower to JSX on MorphHost', () => {
      const code = `
        import { LitElement, html } from 'lit';

        export class SubMethodTemplateHost extends LitElement {
          renderHeader() {
            return html\`<header class="card-header"><slot name="header"><span>Default Header</span></slot></header>\`;
          }

          render() {
            return html\`
              <div class="card-box">
                \${this.renderHeader()}
                <div class="card-body"><slot>Default Body</slot></div>
              </div>
            \`;
          }
        }
      `;

      const res = compileModule(code, { filePath: 'sub-method-template.ts' });
      expect(res.code).toContain('partitionSlots');
      expect(res.code).not.toContain('return html`<header');

      const SubMethodTemplateHost = evalComponent(res.code, 'SubMethodTemplateHost');
      const rendered = stripComments(
        renderToString(React.createElement(SubMethodTemplateHost, null, React.createElement('span', { slot: 'header' }, 'Custom Header'), React.createElement('span', null, 'Custom Body'))),
      );
      expect(rendered).toContain('card-header');
      expect(rendered).toContain('Custom Header');
      expect(rendered).not.toContain('Default Header');
      expect(rendered).toContain('Custom Body');
      expect(rendered).not.toContain('Default Body');
    });

    it('empirically verifies sub-templates in arrow function properties lower to JSX on MorphHost', () => {
      const code = `
        import { LitElement, html } from 'lit';

        export class ArrowPropTemplateHost extends LitElement {
          renderAside = () => html\`<aside class="card-aside"><slot name="aside"><span>Default Aside</span></slot></aside>\`;

          render() {
            return html\`
              <div class="card-box">
                \${this.renderAside()}
                <div class="card-body"><slot>Default Body</slot></div>
              </div>
            \`;
          }
        }
      `;

      const res = compileModule(code, { filePath: 'arrow-prop-template.ts' });
      expect(res.code).toContain('partitionSlots');
      expect(res.code).not.toContain('html`<aside');

      const ArrowPropTemplateHost = evalComponent(res.code, 'ArrowPropTemplateHost');
      const rendered = stripComments(
        renderToString(React.createElement(ArrowPropTemplateHost, null, React.createElement('span', { slot: 'aside' }, 'Custom Aside'), React.createElement('span', null, 'Custom Body'))),
      );
      expect(rendered).toContain('card-aside');
      expect(rendered).toContain('Custom Aside');
      expect(rendered).not.toContain('Default Aside');
      expect(rendered).toContain('Custom Body');
    });

    it('empirically verifies sub-templates in preceding local variables lower to JSX in React component', () => {
      const code = `
        import { LitElement, html } from 'lit';

        export class LocalVarTemplateHost extends LitElement {
          render() {
            const headerTmpl = html\`<header class="local-header"><slot name="header">Fallback</slot></header>\`;
            return html\`<div>\${headerTmpl}</div>\`;
          }
        }
      `;

      const res = compileModule(code, { filePath: 'local-var-template.ts' });
      expect(res.code).not.toContain('const headerTmpl = html`<header');

      const LocalVarTemplateHost = evalComponent(res.code, 'LocalVarTemplateHost');
      const rendered = stripComments(renderToString(React.createElement(LocalVarTemplateHost, null, React.createElement('span', { slot: 'header' }, 'Custom Header Content'))));
      expect(rendered).toContain('local-header');
      expect(rendered).toContain('Custom Header Content');
      expect(rendered).not.toContain('Fallback');
    });

    it('empirically verifies named slot and declared property collision resolution with isValidElement disambiguation', () => {
      const code = `
        import { LitElement, html, property } from 'lit';

        export class SlotPropCollisionHost extends LitElement {
          @property({ type: String })
          status = 'idle';

          @property({ type: String })
          badge = 'default-badge';

          render() {
            return html\`
              <div class="status-card">
                <div class="prop-val">\${this.status}</div>
                <div class="slot-container">
                  <slot name="status"><span>Default Status Fallback</span></slot>
                </div>
                <div class="badge-container">
                  <slot name="badge"><span>Default Badge Fallback</span></slot>
                </div>
              </div>
            \`;
          }
        }
      `;

      const res = compileModule(code, { filePath: 'slot-prop-collision.ts' });
      expect(res.code).toContain('isValidElement');

      const SlotPropCollisionHost = evalComponent(res.code, 'SlotPropCollisionHost');

      // Case A: scalar property status="active", but slotted child provided for slot="status"
      // Slotted child must be preserved in <slot name="status">, NOT shadowed by "active"
      const renderedA = stripComments(renderToString(React.createElement(SlotPropCollisionHost, { status: 'active' }, React.createElement('span', { slot: 'status' }, 'Custom Slotted Status'))));
      expect(renderedA).toContain('Custom Slotted Status');
      expect(renderedA).not.toContain('Default Status Fallback');

      // Case B: scalar property badge="custom-badge", no slotted child provided for slot="badge"
      // Scalar prop must NOT overwrite slot fallback
      const renderedB = stripComments(renderToString(React.createElement(SlotPropCollisionHost, { badge: 'custom-badge' })));
      expect(renderedB).toContain('Default Badge Fallback');
      expect(renderedB).not.toContain('custom-badge</span>');

      // Case C: React element passed as prop badge={React.createElement('span', null, 'Prop Element Badge')}
      // Genuine React element prop is accepted as slot content
      const renderedC = stripComments(
        renderToString(
          React.createElement(SlotPropCollisionHost, {
            badge: React.createElement('span', null, 'Prop Element Badge'),
          }),
        ),
      );
      expect(renderedC).toContain('Prop Element Badge');
    });
  });
});
