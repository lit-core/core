import { describe, expect, it } from 'vitest';
import { transformElemProxy } from '../elem-proxy/src/index.js';
import { classify, transformNative } from '../native/src/index.js';

function prepareRunnableCode(code: string): string {
  return code
    .replace(/import [^;]+;/g, '')
    .replace(/export\s+default\s+/g, '')
    .replace(/export\s+class\s+/g, 'class ')
    .replace(/export\s+\{[^}]+\};?/g, '');
}

describe('empirical challenger m5 iteration 3 instance 2 independent stress suite', () => {
  // =========================================================================
  // 1. ELEM-PROXY DEEP PROTOTYPE HIERARCHY AND LIFECYCLE FIDELITY
  // =========================================================================
  describe('elem-proxy multi-level inheritance and prototype purity', () => {
    it('traverses multi-level class hierarchy preserving methods across 3 inheritance tiers', () => {
      const input = `
import { LitElement } from 'lit';

export class Level1Base extends LitElement {
  baseLevel1Method() { return 'level-1'; }
}

export class Level2Middle extends Level1Base {
  middleLevel2Method() { return 'level-2'; }
}

export class LeafComponent extends Level2Middle {
  static properties = {
    leafProp: { type: String },
  };
  leafMethod() { return 'leaf'; }
}
customElements.define('leaf-component', LeafComponent);
`;
      const res = transformElemProxy(input);
      const codeToRun = prepareRunnableCode(res.code);

      class MockHTMLElement {
        isConnected = false;
      }
      class MockLitElement extends MockHTMLElement {
        static finalize() {}
        litCoreMethod() {
          return 'lit-core';
        }
      }

      let RegisteredClass: any = null;
      const fn = new Function('HTMLElement', 'LitElement', 'customElements', codeToRun);
      fn(MockHTMLElement, MockLitElement, {
        define: (_tag: string, cls: any) => {
          RegisteredClass = cls;
        },
      });

      const el = new RegisteredClass();
      // Upgrade via property set
      el.leafProp = 'active';

      // Check all 4 tiers of methods exist on upgraded element
      expect(typeof el.leafMethod).toBe('function');
      expect(el.leafMethod()).toBe('leaf');

      expect(typeof el.middleLevel2Method).toBe('function');
      expect(el.middleLevel2Method()).toBe('level-2');

      expect(typeof el.baseLevel1Method).toBe('function');
      expect(el.baseLevel1Method()).toBe('level-1');

      expect(typeof el.litCoreMethod).toBe('function');
      expect(el.litCoreMethod()).toBe('lit-core');
    });

    it('verifies prototype identity remains unchanged (Object.getPrototypeOf is constant)', () => {
      const input = `
import { LitElement } from 'lit';

export class ProtoCheckEl extends LitElement {
  static properties = { tag: { type: String } };
}
customElements.define('proto-check-el', ProtoCheckEl);
`;
      const res = transformElemProxy(input);
      const codeToRun = prepareRunnableCode(res.code);

      class MockHTMLElement {
        isConnected = false;
      }
      class MockLitElement extends MockHTMLElement {
        static finalize() {}
      }

      let RegisteredClass: any = null;
      const fn = new Function('HTMLElement', 'LitElement', 'customElements', codeToRun);
      fn(MockHTMLElement, MockLitElement, {
        define: (_tag: string, cls: any) => {
          RegisteredClass = cls;
        },
      });

      const el = new RegisteredClass();
      const protoPre = Object.getPrototypeOf(el);

      el.tag = 'tested';
      const protoPost = Object.getPrototypeOf(el);

      expect(protoPre).toBe(protoPost);
      expect(protoPost).toBe(RegisteredClass.prototype);
      expect(res.code).not.toContain('Object.setPrototypeOf');
      expect(res.code).not.toContain('setPrototypeOf');
    });

    it('verifies complete absence of Reflect.construct and speculative instantiation', () => {
      const input = `
import { LitElement } from 'lit';

export class NoSpeculativeEl extends LitElement {
  static properties = { data: { type: Object } };
}
customElements.define('no-speculative-el', NoSpeculativeEl);
`;
      const res = transformElemProxy(input);
      expect(res.code).not.toContain('Reflect.construct');
      expect(res.code).not.toContain('Reflect.');

      // Check constructor body
      expect(res.code).toContain('constructor() {');
      expect(res.code).toContain('super();');
      expect(res.code).toContain('this.__upgraded = false;');
      expect(res.code).toContain('this.__attrBuffer = null;');
    });

    it('isolates state across 5 distinct component classes in the same module', () => {
      const input = `
import { LitElement } from 'lit';

export class Comp1 extends LitElement { static properties = { p1: { type: String } }; }
customElements.define('c-1', Comp1);

export class Comp2 extends LitElement { static properties = { p2: { type: Number } }; }
customElements.define('c-2', Comp2);

export class Comp3 extends LitElement { static properties = { p3: { type: Boolean } }; }
customElements.define('c-3', Comp3);

export class Comp4 extends LitElement { static properties = { p4: { type: Array } }; }
customElements.define('c-4', Comp4);

export class Comp5 extends LitElement { static properties = { p5: { type: Object } }; }
customElements.define('c-5', Comp5);
`;
      const res = transformElemProxy(input);
      expect(res.proxiedElementsCount).toBe(5);

      const registry: Record<string, any> = {};
      class MockHTMLElement {
        isConnected = false;
      }
      class MockLitElement extends MockHTMLElement {
        static finalize() {}
      }

      const codeToRun = prepareRunnableCode(res.code);
      const fn = new Function('HTMLElement', 'LitElement', 'customElements', codeToRun);
      fn(MockHTMLElement, MockLitElement, {
        define: (n: string, c: any) => {
          registry[n] = c;
        },
      });

      const e1 = new registry['c-1']();
      const e2 = new registry['c-2']();
      const e3 = new registry['c-3']();
      const e4 = new registry['c-4']();
      const e5 = new registry['c-5']();

      e1.p1 = 'val1';
      e2.p2 = 100;
      e3.p3 = true;
      e4.p4 = ['a'];
      e5.p5 = { k: 'v' };

      expect(e1.p1).toBe('val1');
      expect(e2.p2).toBe(100);
      expect(e3.p3).toBe(true);
      expect(e4.p4).toEqual(['a']);
      expect(e5.p5).toEqual({ k: 'v' });

      expect(e1.p2).toBeUndefined();
      expect(e2.p1).toBeUndefined();
    });
  });

  // =========================================================================
  // 2. NATIVE REGISTRATION DEDUPLICATION AND MINIFICATION SAFETY
  // =========================================================================
  describe('native compiler registration deduplication and bailout robustness', () => {
    it('verifies exactly one define call when class is registered via customElements.define', () => {
      const input = `
import { LitElement, html } from 'lit';

export class ExplicitCard extends LitElement {
  render() {
    return html\`<div>card</div>\`;
  }
}
customElements.define('explicit-card', ExplicitCard);
`;
      const res = transformNative(input);
      expect(res.vanillaCount).toBe(1);

      const matches = res.code.match(/customElements\.define\(['"]explicit-card['"],\s*ExplicitCard\)/g);
      expect(matches).not.toBeNull();
      expect(matches).toHaveLength(1);
    });

    it('verifies exactly one define call when class uses @customElement decorator', () => {
      const input = `
import { LitElement, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';

@customElement('decorator-card')
export class DecoratorCard extends LitElement {
  @property() title = 'Card Title';
  render() {
    return html\`<h1>\${this.title}</h1>\`;
  }
}
`;
      const res = transformNative(input);
      expect(res.vanillaCount).toBe(1);

      const matches = res.code.match(/customElements\.define\(['"]decorator-card['"],\s*DecoratorCard\)/g);
      expect(matches).not.toBeNull();
      expect(matches).toHaveLength(1);
    });

    it('verifies runtime registration throws zero NotSupportedError on duplicate registration', () => {
      const input = `
import { LitElement, html } from 'lit';

export class NoDupEl extends LitElement {
  render() { return html\`<p>no-dup</p>\`; }
}
customElements.define('no-dup-el', NoDupEl);
`;
      const res = transformNative(input);
      const codeToRun = prepareRunnableCode(res.code);

      const definedTags = new Set<string>();
      const mockCE = {
        define: (name: string, _cls: any) => {
          if (definedTags.has(name)) {
            throw new Error(`NotSupportedError: '${name}' has already been defined`);
          }
          definedTags.add(name);
        },
      };

      const mockDocument = {
        createElement: (_tag: string) => ({
          content: { cloneNode: () => ({}) },
        }),
      };

      const fn = new Function('HTMLElement', 'customElements', 'document', codeToRun);
      expect(() => {
        fn(class MockHTMLElement {}, mockCE, mockDocument);
      }).not.toThrow();

      expect(definedTags.has('no-dup-el')).toBe(true);
    });

    it('leaves input completely untouched on unsupported dynamic tag expression', () => {
      const input = `
import { LitElement, html } from 'lit';

export class DynTagComponent extends LitElement {
  constructor() {
    super();
    this.heading = 'h3';
  }
  render() {
    return html\`<\${this.heading}>Text</\${this.heading}>\`;
  }
}
customElements.define('dyn-tag-comp', DynTagComponent);
`;
      const res = transformNative(input);
      expect(res.vanillaCount).toBe(0);
      expect(res.code).toContain('class DynTagComponent extends LitElement');
      expect(res.code).toContain('return html`<${this.heading}>Text</${this.heading}>`;');
      expect(res.code).not.toContain('__lit_tmpl');
    });

    it('leaves input completely untouched on unsupported dynamic attribute expression', () => {
      const input = `
import { LitElement, html } from 'lit';

export class DynAttrComponent extends LitElement {
  render() {
    return html\`<div \${this.dynProp}="value">Text</div>\`;
  }
}
customElements.define('dyn-attr-comp', DynAttrComponent);
`;
      const res = transformNative(input);
      expect(res.vanillaCount).toBe(0);
      expect(res.code).toContain('class DynAttrComponent extends LitElement');
      expect(res.code).toContain('return html`<div ${this.dynProp}="value">Text</div>`;');
      expect(res.code).not.toContain('__lit_tmpl');
    });

    it('rejects plain classes and non-Lit custom elements from classification', () => {
      const samples = [
        'export class PlainUtility { render() { return true; } }',
        'export class VanillaCE extends HTMLElement { render() { return "html"; } }',
        'import React from "react"; export class ReactWidget extends React.Component { render() {} }',
      ];

      for (const sample of samples) {
        const classified = classify(sample);
        expect(classified).toHaveLength(0);
      }
    });
  });
});
