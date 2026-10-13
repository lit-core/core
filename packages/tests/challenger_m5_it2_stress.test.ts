import { describe, expect, it } from 'vitest';
import { transformElemProxy } from '../elem-proxy/src/index.js';
import { classify, transformNative } from '../native/src/index.js';

describe('empirical challenger m5 iteration 2 stress test battery', () => {
  // =========================================================================
  // FOCUS AREA 1 & 2: ELEM-PROXY LAZY UPGRADE, PROTOTYPE, & PROPERTY EXECUTION
  // =========================================================================
  describe('packages/elem-proxy runtime lazy upgrade & prototype integrity', () => {
    it('evaluates transformed module in JavaScript runtime with zero TypeError', () => {
      const input = `
import { LitElement } from 'lit';

export class SafeEvalEl extends LitElement {
  static properties = {
    message: { type: String },
    count: { type: Number },
    disabled: { type: Boolean },
  };
}
customElements.define('safe-eval-el', SafeEvalEl);
`;
      const res = transformElemProxy(input);
      expect(res.proxiedElementsCount).toBe(1);

      // Verify emitted property descriptors use { get: function() { ... }, set: function(__v) { ... } }
      expect(res.code).not.toContain('get get()');
      expect(res.code).not.toContain('set set(__v)');
      expect(res.code).toContain('get: function()');
      expect(res.code).toContain('set: function(__v)');

      // Evaluate directly in JavaScript runtime with mock DOM
      const codeToRun = res.code.replace(/import [^;]+;/g, '').replace(/export [^;]+;/g, '');
      let errorThrown: any = null;
      try {
        const fn = new Function('HTMLElement', 'LitElement', 'customElements', codeToRun);
        fn(class MockHTMLElement {}, class MockLitElement {}, { define: () => {} });
      } catch (err) {
        errorThrown = err;
      }

      expect(errorThrown).toBeNull();
    });

    it('verifies complete absence of Object.setPrototypeOf across emitted code', () => {
      const testCases = [
        `
import { LitElement, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';

@customElement('check-proto-1')
export class CheckProto1 extends LitElement {
  @property() val = 'a';
  render() { return html\`<div>\${this.val}</div>\`; }
}
`,
        `
import { LitElement } from 'lit';

export class CheckProto2 extends LitElement {
  static properties = {
    title: { type: String },
    count: { type: Number, attribute: 'data-count' },
  };
}
customElements.define('check-proto-2', CheckProto2);
`,
        `
import * as dec from 'lit/decorators.js';
import { LitElement } from 'lit';

@dec.customElement('check-proto-3')
export class CheckProto3 extends LitElement {
  @dec.property() flag = true;
  @dec.state() internal = 123;
}
`,
      ];

      for (const input of testCases) {
        const res = transformElemProxy(input);
        expect(res.proxiedElementsCount).toBe(1);
        expect(res.code).not.toContain('Object.setPrototypeOf');
        expect(res.code).not.toContain('setPrototypeOf');
      }
    });

    it('verifies complete absence of Reflect.construct and speculative instantiation', () => {
      const input = `
import { LitElement } from 'lit';

export class NoSpeculativeEl extends LitElement {
  static properties = {
    data: { type: Object },
  };
}
customElements.define('no-speculative-el', NoSpeculativeEl);
`;
      const res = transformElemProxy(input);
      expect(res.proxiedElementsCount).toBe(1);

      // Emitted code must not contain Reflect.construct
      expect(res.code).not.toContain('Reflect.construct');
      expect(res.code).not.toContain('Reflect.');

      // Check constructor body: constructor must only call super() and initialize flags
      expect(res.code).toContain('constructor() {');
      expect(res.code).toContain('this.__upgraded = false;');
      expect(res.code).toContain('this.__attrBuffer = null;');
      expect(res.code).not.toContain('return Reflect.construct');
    });

    it('empirically reveals infinite recursion (RangeError: Maximum call stack size exceeded) on property read or write', () => {
      const input = `
import { LitElement } from 'lit';

export class RecursiveEl extends LitElement {
  static properties = {
    label: { type: String },
  };
}
customElements.define('recursive-el', RecursiveEl);
`;
      const res = transformElemProxy(input);
      expect(res.proxiedElementsCount).toBe(1);

      const registry: Record<string, any> = {};
      const mockCE = {
        define(n: string, c: any) {
          registry[n] = c;
        },
      };

      class MockHTMLElement {}
      class MockLitElement extends MockHTMLElement {
        static finalize() {}
      }
      Object.defineProperty(MockLitElement.prototype, 'label', {
        get() {
          return this._label || 'lit-default';
        },
        set(v) {
          this._label = v;
        },
        configurable: true,
      });

      const codeToRun = res.code.replace(/import [^;]+;/g, '').replace(/export [^;]+;/g, '');
      const fn = new Function('HTMLElement', 'LitElement', 'customElements', codeToRun);
      fn(MockHTMLElement, MockLitElement, mockCE);

      const ProxyEl = registry['recursive-el'];
      const instance = new ProxyEl();

      // Because `!(k in this)` in builder.rs evaluates to false when k is defined on ProxyEl.prototype,
      // the real property descriptor from MockLitElement.prototype is never copied to the instance.
      // Consequently, accessing this[__p] inside the getter or setter triggers infinite recursion.
      let writeError: any = null;
      try {
        instance.label = 'new-value';
      } catch (err) {
        writeError = err;
      }

      expect(writeError).not.toBeNull();
      expect(writeError.name).toBe('RangeError');
      expect(writeError.message).toContain('Maximum call stack size exceeded');

      const instance2 = new ProxyEl();
      let readError: any = null;
      try {
        const val = instance2.label;
      } catch (err) {
        readError = err;
      }

      expect(readError).not.toBeNull();
      expect(readError.name).toBe('RangeError');
      expect(readError.message).toContain('Maximum call stack size exceeded');
    });

    it('empirically demonstrates premature connectedCallback invocation during property upgrade on unconnected element', () => {
      const input = `
import { LitElement } from 'lit';

export class PrematureConnectedEl extends LitElement {
  static properties = {
    data: { type: String },
  };
}
customElements.define('premature-connected-el', PrematureConnectedEl);
`;
      const res = transformElemProxy(input);
      expect(res.proxiedElementsCount).toBe(1);

      // Inspect __upgrade method body: RealClass.prototype.connectedCallback.call(this) is invoked unconditionally
      expect(res.code).toContain('RealClass.prototype.connectedCallback.call(this)');
      // Notice absence of this.isConnected guard around connectedCallback call
      expect(res.code).not.toContain('this.isConnected && typeof RealClass.prototype.connectedCallback');
    });

    it('buffers attributeChangedCallback calls before upgrade and flushes upon upgrade', () => {
      const input = `
import { LitElement } from 'lit';

export class AttrBufferEl extends LitElement {
  static properties = {
    theme: { type: String },
  };
}
customElements.define('attr-buffer-el', AttrBufferEl);
`;
      const res = transformElemProxy(input);
      expect(res.proxiedElementsCount).toBe(1);

      class MockHTMLElement {
        __upgraded = false;
        __attrBuffer = null;
      }
      class MockLitElement extends MockHTMLElement {}

      const definedClasses: Record<string, any> = {};
      const mockCustomElements = {
        define(name: string, cls: any) {
          definedClasses[name] = cls;
        },
      };

      const codeToRun = res.code.replace(/import [^;]+;/g, '').replace(/export [^;]+;/g, '');
      const setupModule = new Function('HTMLElement', 'LitElement', 'customElements', codeToRun);
      setupModule(MockHTMLElement, MockLitElement, mockCustomElements);

      const ProxyClass = definedClasses['attr-buffer-el'];
      const el = new ProxyClass();

      // Set attribute while not upgraded
      el.attributeChangedCallback('theme', null, 'dark');
      expect(el.__attrBuffer).toBeInstanceOf(Map);
      expect(el.__attrBuffer.get('theme')).toBe('dark');
    });

    it('handles multiple custom elements in the same file with zero namespace collision', () => {
      const input = `
import { LitElement } from 'lit';

export class FirstEl extends LitElement {
  static properties = { propA: { type: String } };
}
customElements.define('first-el', FirstEl);

export class SecondEl extends LitElement {
  static properties = { propB: { type: Number } };
}
customElements.define('second-el', SecondEl);
`;
      const res = transformElemProxy(input);
      expect(res.proxiedElementsCount).toBe(2);
      expect(res.code).toContain('__getImpl_FirstEl');
      expect(res.code).toContain('__getImpl_SecondEl');
      expect(res.code).toContain('__impl_FirstEl');
      expect(res.code).toContain('__impl_SecondEl');
      expect(res.code).not.toContain('Object.setPrototypeOf');
      expect(res.code).not.toContain('Reflect.construct');
    });
  });

  // =========================================================================
  // FOCUS AREA 3: NATIVE COMPILER CLASSIFICATION AGAINST COMPLEX HIERARCHIES
  // =========================================================================
  describe('packages/native classification boundaries', () => {
    it('returns empty classification for non-Lit classes with render methods', () => {
      // 1. React Component
      const reactInput = `
import React from 'react';

export class MyReactWidget extends React.Component {
  render() {
    return React.createElement('div', null, 'Hello React');
  }
}
`;
      const reactRes = classify(reactInput);
      expect(reactRes).toHaveLength(0);

      // 2. Custom ORM / Entity Model with render
      const ormInput = `
export class EntityModel {
  render() {
    return { serialized: true, data: this.fields };
  }
}
`;
      const ormRes = classify(ormInput);
      expect(ormRes).toHaveLength(0);

      // 3. Template compiler utility
      const utilInput = `
export class MarkdownRenderer {
  render(content) {
    return parse(content);
  }
}
`;
      const utilRes = classify(utilInput);
      expect(utilRes).toHaveLength(0);
    });

    it('correctly classifies leaf LitElement components as Mode A vanilla', () => {
      const input = `
import { LitElement, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';

@customElement('leaf-badge')
export class LeafBadge extends LitElement {
  @property() label = 'badge';

  render() {
    return html\`<span class="badge">\${this.label}</span>\`;
  }
}
`;
      const res = classify(input);
      expect(res).toHaveLength(1);
      expect(res[0].mode).toBe('vanilla');
      expect(res[0].reason).toBe('Genuine leaf component');
    });

    it('correctly classifies custom base element subclasses as Mode B micro', () => {
      const input = `
import { LitElement, html } from 'lit';

export class CustomBaseElement extends LitElement {
  connectedCallback() {
    super.connectedCallback();
  }
}

export class CustomChildWidget extends CustomBaseElement {
  render() {
    return html\`<div>child</div>\`;
  }
}
`;
      const res = classify(input);
      expect(res).toHaveLength(1);
      expect(res[0].componentName).toBe('CustomChildWidget');
      expect(res[0].mode).toBe('micro');
      expect(res[0].reason).toBe('Subclasses custom base element');
    });

    it('respects aliased and mangled LitElement and html imports', () => {
      const input = `
import { LitElement as Base, html as tmpl } from 'lit';

export class MangledImportEl extends Base {
  render() {
    return tmpl\`<div>mangled</div>\`;
  }
}
customElements.define('mangled-el', MangledImportEl);
`;
      const res = classify(input);
      expect(res).toHaveLength(1);
      expect(res[0].componentName).toBe('MangledImportEl');
      expect(res[0].mode).toBe('vanilla');
    });

    it('classifies complex components with directives or lifecycle overrides as Mode B micro', () => {
      const input = `
import { LitElement, html } from 'lit';

export class ComplexEl extends LitElement {
  firstUpdated() {
    console.log('first updated');
  }

  render() {
    return html\`<div>complex</div>\`;
  }
}
`;
      const res = classify(input);
      expect(res).toHaveLength(1);
      expect(res[0].mode).toBe('micro');
      expect(res[0].reason).toContain('Complex lifecycle');
    });
  });

  // =========================================================================
  // FOCUS AREA 3 (CONT.): CLEAN BAILOUTS ON DYNAMIC TEMPLATES IN NATIVE COMPILER
  // =========================================================================
  describe('packages/native clean bailouts on dynamic templates', () => {
    it('cleanly bails out on dynamic tag name expressions and leaves code untouched', () => {
      const input = `
import { LitElement, html } from 'lit';

export class DynamicTagComp extends LitElement {
  constructor() {
    super();
    this.tag = 'h1';
  }

  render() {
    return html\`<\${this.tag}>Dynamic heading</\${this.tag}>\`;
  }
}
customElements.define('dynamic-tag-comp', DynamicTagComp);
`;
      const res = transformNative(input);
      expect(res.vanillaCount).toBe(0);
      expect(res.code).toContain('return html`<${this.tag}>Dynamic heading</${this.tag}>`;');
      expect(res.code).not.toContain('__lit_tmpl');
      expect(res.code).not.toContain('<"__lit_exp');
      expect(res.code).not.toContain('setAttribute("",');
    });

    it('cleanly bails out on dynamic attribute names without equals sign', () => {
      const input = `
import { LitElement, html } from 'lit';

export class DynamicAttrComp extends LitElement {
  render() {
    return html\`<div \${this.dynamicProp}="value">Text</div>\`;
  }
}
customElements.define('dynamic-attr-comp', DynamicAttrComp);
`;
      const res = transformNative(input);
      expect(res.vanillaCount).toBe(0);
      expect(res.code).toContain('return html`<div ${this.dynamicProp}="value">Text</div>`;');
      expect(res.code).not.toContain('__lit_tmpl');
    });

    it('cleanly bails out on bare expression inside opening tag', () => {
      const input = `
import { LitElement, html } from 'lit';

export class BareExprComp extends LitElement {
  render() {
    return html\`<button \${this.spreadProps}>Click</button>\`;
  }
}
customElements.define('bare-expr-comp', BareExprComp);
`;
      const res = transformNative(input);
      expect(res.vanillaCount).toBe(0);
      expect(res.code).toContain('return html`<button ${this.spreadProps}>Click</button>`;');
      expect(res.code).not.toContain('__lit_tmpl');
    });

    it('cleanly bails out when render method does not return a template literal', () => {
      const input = `
import { LitElement } from 'lit';

export class NonTemplateComp extends LitElement {
  render() {
    return this.cachedMarkup;
  }
}
customElements.define('non-template-comp', NonTemplateComp);
`;
      const res = transformNative(input);
      expect(res.vanillaCount).toBe(0);
      expect(res.code).toContain('return this.cachedMarkup;');
      expect(res.code).not.toContain('<slot></slot>');
    });

    it('successfully compiles valid static templates with customElement decorator', () => {
      const input = `
import { LitElement, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';

@customElement('valid-leaf-comp')
export class ValidLeafComp extends LitElement {
  @property() text = 'hello';

  render() {
    return html\`<button @click=\${this.onClick}>\${this.text}</button>\`;
  }
}
`;
      const res = transformNative(input);
      expect(res.vanillaCount).toBe(1);
      expect(res.code).toContain('__lit_tmpl_ValidLeafComp');
      expect(res.code).toContain('__lit_tmpl_ValidLeafComp.innerHTML = "<button><!----></button>";');
      expect(res.code).toContain('addEventListener("click", (e) => this.onClick(e));');
      expect(res.code).toContain('customElements.define("valid-leaf-comp", ValidLeafComp);');
      // Verify customElements.define is only emitted once with decorator
      const matches = res.code.match(/customElements\.define\("valid-leaf-comp", ValidLeafComp\);/g);
      expect(matches).toHaveLength(1);
    });

    it('empirically reveals duplicate customElements.define emission when input already contains customElements.define call', () => {
      const input = `
import { LitElement, html } from 'lit';

export class DupDefineComp extends LitElement {
  render() {
    return html\`<div>hello</div>\`;
  }
}
customElements.define('dup-define-comp', DupDefineComp);
`;
      const res = transformNative(input);
      expect(res.vanillaCount).toBe(1);

      // Defect: vanilla.rs line 271 emits an extra helper.define_custom_element call
      // without pruning the existing customElements.define statement in AST,
      // resulting in two identical definitions that crash in browser with NotSupportedError
      const matches = res.code.match(/customElements\.define\("dup-define-comp", DupDefineComp\);/g);
      expect(matches).toHaveLength(2);
    });
  });
});
