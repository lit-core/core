import { describe, expect, it } from 'vitest';
import { transformElemProxy } from '../elem-proxy/src/index.js';
import { classify, transformNative } from '../native/src/index.js';

describe('empirical challenger m5 stress test suite', () => {
  // ==========================================
  // 1. ELEM-PROXY EMPIRICAL STRESS TESTS
  // ==========================================
  describe('elem-proxy package', () => {
    it('verifies absence of suite-specific properties and private Lit mangled internals', () => {
      const input = `
import { LitElement, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';

@customElement('suite-test-el')
export class SuiteTestEl extends LitElement {
  @property() name = 'test';
  render() { return html\`<div>\${this.name}</div>\`; }
}
`;
      const res = transformElemProxy(input);
      expect(res.proxiedElementsCount).toBe(1);

      // Verify zero suite-specific properties
      expect(res.code).not.toContain('initialReflectedProperties');
      expect(res.code).not.toContain('assumeInteractionOn');
      expect(res.code).not.toContain('validators');
      expect(res.code).not.toContain('emittedEvents');

      // Verify zero private Lit internal mangled variables
      expect(res.code).not.toContain('_$Em');
      expect(res.code).not.toContain('_$Ev');
      expect(res.code).not.toContain('_$AL');
    });

    it('verifies absence of Object.setPrototypeOf in proxy stub generation', () => {
      const input = `
import { LitElement, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';

@customElement('proto-test-el')
export class ProtoTestEl extends LitElement {
  @property() value = 'hello';
  render() { return html\`<div>\${this.value}</div>\`; }
}
`;
      const res = transformElemProxy(input);
      expect(res.proxiedElementsCount).toBe(1);

      // Verify Object.setPrototypeOf is completely eliminated
      expect(res.code).not.toContain('Object.setPrototypeOf');
    });

    it('verifies absence of speculative instantiation via Reflect.construct in __upgrade', () => {
      const input = `
import { LitElement, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';

@customElement('speculative-test-el')
export class SpeculativeTestEl extends LitElement {
  @property() count = 0;
  render() { return html\`<div>\${this.count}</div>\`; }
}
`;
      const res = transformElemProxy(input);
      expect(res.proxiedElementsCount).toBe(1);

      // Verify Reflect.construct is completely eliminated
      expect(res.code).not.toContain('Reflect.construct');
    });

    it('verifies valid accessor descriptor syntax and zero TypeError on module load', () => {
      const input = `
import { LitElement } from 'lit';

export class CrashEl extends LitElement {
  static properties = {
    message: { type: String }
  };
}
customElements.define('crash-el', CrashEl);
`;
      const res = transformElemProxy(input);
      expect(res.proxiedElementsCount).toBe(1);

      // Verify absence of invalid accessor getter-method syntax
      expect(res.code).not.toContain('get get()');
      expect(res.code).not.toContain('set set(__v)');

      // Verify standard property descriptor functions are synthesized
      expect(res.code).toContain('get: function()');
      expect(res.code).toContain('set: function(__v)');

      // Evaluating this code in a standard JS environment must succeed with zero TypeError
      const codeToRun = res.code.replace(/import [^;]+;/g, '').replace(/export [^;]+;/g, '');

      let thrownError: Error | null = null;
      try {
        const fn = new Function('HTMLElement', 'LitElement', 'customElements', codeToRun);
        fn(class {}, class {}, { define: () => {} });
      } catch (err: any) {
        thrownError = err;
      }

      expect(thrownError).toBeNull();
    });

    it('handles aliased, namespace, and subpath decorator imports, and ignores non-Lit decorators', () => {
      // 1. Aliased imports
      const aliasedInput = `
import { customElement as ce, property as prop, state as st } from 'lit/decorators.js';

@ce('aliased-proxy-el')
export class AliasedProxyEl {
  @prop({ type: String }) title = 'ok';
  @st() count = 0;
}
`;
      const aliasedRes = transformElemProxy(aliasedInput);
      expect(aliasedRes.proxiedElementsCount).toBe(1);
      expect(aliasedRes.elements[0].tagName).toBe('aliased-proxy-el');
      expect(aliasedRes.elements[0].properties).toContain('title');
      expect(aliasedRes.elements[0].properties).toContain('count');
      expect(aliasedRes.elements[0].observedAttributes).toContain('title');
      expect(aliasedRes.elements[0].observedAttributes).not.toContain('count');

      // 2. Namespace imports
      const nsInput = `
import * as dec from 'lit/decorators.js';

@dec.customElement('ns-proxy-el')
export class NsProxyEl {
  @dec.property({ type: String }) name = 'test';
  @dec.state() active = true;
}
`;
      const nsRes = transformElemProxy(nsInput);
      expect(nsRes.proxiedElementsCount).toBe(1);
      expect(nsRes.elements[0].tagName).toBe('ns-proxy-el');
      expect(nsRes.elements[0].observedAttributes).toContain('name');
      expect(nsRes.elements[0].observedAttributes).not.toContain('active');

      // 3. Subpath imports
      const subpathInput = `
import { customElement } from '@lit/reactive-element/decorators/custom-element.js';
import { property } from '@lit/reactive-element/decorators/property.js';
import { state } from '@lit/reactive-element/decorators/state.js';

@customElement('subpath-proxy-el')
export class SubpathProxyEl {
  @property() text = 'abc';
  @state() open = false;
}
`;
      const subpathRes = transformElemProxy(subpathInput);
      expect(subpathRes.proxiedElementsCount).toBe(1);
      expect(subpathRes.elements[0].tagName).toBe('subpath-proxy-el');

      // 4. Non-Lit decorator imports ignored
      const nonLitInput = `
import { customElement, property } from 'not-lit';

@customElement('fake-proxy-el')
export class FakeProxyEl {
  @property() val = 123;
}
`;
      const nonLitRes = transformElemProxy(nonLitInput);
      expect(nonLitRes.proxiedElementsCount).toBe(0);
      expect(nonLitRes.code.trim()).toBe(nonLitInput.trim());
    });

    it('verifies property reflection and observedAttributes filtering with static properties', () => {
      const staticInput = `
import { LitElement } from 'lit';

export class StaticProxyEl extends LitElement {
  static properties = {
    normalProp: { type: String },
    noAttrProp: { type: Number, attribute: false },
    customAttrProp: { type: Boolean, attribute: 'custom-flag' },
    internalState: { state: true },
  };
}
customElements.define('static-proxy-el', StaticProxyEl);
`;
      const res = transformElemProxy(staticInput);
      expect(res.proxiedElementsCount).toBe(1);
      expect(res.elements[0].properties).toContain('normalProp');
      expect(res.elements[0].properties).toContain('noAttrProp');
      expect(res.elements[0].properties).toContain('customAttrProp');
      expect(res.elements[0].properties).toContain('internalState');

      // observedAttributes should include normalProp and custom-flag, but exclude noAttrProp and internalState
      expect(res.elements[0].observedAttributes).toContain('normalprop');
      expect(res.elements[0].observedAttributes).toContain('custom-flag');
      expect(res.elements[0].observedAttributes).not.toContain('noAttrProp');
      expect(res.elements[0].observedAttributes).not.toContain('internalState');
    });
  });

  // ==========================================
  // 2. NATIVE COMPILER EMPIRICAL STRESS TESTS
  // ==========================================
  describe('native package', () => {
    it('handles quotes and angle brackets inside attribute values', () => {
      const input = `
import { LitElement, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';

@customElement('angle-quote-el')
export class AngleQuoteEl extends LitElement {
  @property({ type: String }) titleText = 'hello';

  render() {
    return html\`<button title="Click <here> to 'continue'" data-note='Say "yes"' @click=\${this._onClick}>\${this.titleText}</button>\`;
  }
}
`;
      const classification = classify(input);
      expect(classification).toHaveLength(1);
      expect(classification[0].mode).toBe('vanilla');

      const res = transformNative(input);
      expect(res.vanillaCount).toBe(1);
      expect(res.code).toContain('class AngleQuoteEl extends HTMLElement');
      expect(res.code).toContain('addEventListener("click"');
      expect(res.code).toContain('title=\\"Click <here> to \'continue\'\\"');
    });

    it('handles HTML comments containing angle brackets and arrows', () => {
      const input = `
import { LitElement, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';

@customElement('comment-el')
export class CommentEl extends LitElement {
  @property({ type: String }) msg = 'ok';

  render() {
    return html\`<div><!-- comment with > arrow and <tag> inside --><span>\${this.msg}</span></div>\`;
  }
}
`;
      const classification = classify(input);
      expect(classification).toHaveLength(1);
      expect(classification[0].mode).toBe('vanilla');

      const res = transformNative(input);
      expect(res.vanillaCount).toBe(1);
      expect(res.code).toContain('class CommentEl extends HTMLElement');
      expect(res.code).toContain('<!-- comment with > arrow and <tag> inside -->');
    });

    it('handles multiline templates with formatting and SVG elements', () => {
      const input = `
import { LitElement, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';

@customElement('svg-icon-el')
export class SvgIconEl extends LitElement {
  @property({ type: String }) fill = 'currentColor';

  render() {
    return html\`
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        width="24"
        height="24"
      >
        <path d="M12 2L2 22h20L12 2z" fill="\${this.fill}" />
      </svg>
    \`;
  }
}
`;
      const classification = classify(input);
      expect(classification).toHaveLength(1);
      expect(classification[0].mode).toBe('vanilla');

      const res = transformNative(input);
      expect(res.vanillaCount).toBe(1);
      expect(res.code).toContain('class SvgIconEl extends HTMLElement');
      expect(res.code).toContain('<svg');
    });

    it('cleanly bails out without synthesizing fabricated <slot></slot>', () => {
      const inputWithoutQuasis = `
import { LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';

@customElement('no-template-el')
export class NoTemplateEl extends LitElement {
  @property({ type: String }) message = 'hello';

  render() {
    return "just plain text";
  }
}
`;
      const res = transformNative(inputWithoutQuasis);
      // When render returns plain string (not html tagged template), it should cleanly bail out
      expect(res.vanillaCount).toBe(0);
      expect(res.code).not.toContain('<slot></slot>');
      expect(res.code).toContain('class NoTemplateEl extends LitElement');
    });

    it('preserves arbitrary event handler expressions without string trimming', () => {
      const input = `
import { LitElement, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';

function externalHandler(e) {}

@customElement('handler-expr-el')
export class HandlerExprEl extends LitElement {
  @property() label = 'click';

  render() {
    return html\`
      <button @click=\${externalHandler}>External</button>
      <button @custom-event=\${this.controllers.sub.onAction}>Nested</button>
    \`;
  }
}
`;
      const classification = classify(input);
      expect(classification).toHaveLength(1);

      const res = transformNative(input);
      expect(res.vanillaCount).toBe(1);
      expect(res.code).toContain('externalHandler(e)');
      expect(res.code).toContain('this.controllers.sub.onAction(e)');
      expect(res.code).toContain('addEventListener("custom-event"');
    });

    it('does not synthesize fabricated default literals for uninitialized properties', () => {
      const input = `
import { LitElement, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';

@customElement('uninit-props-el')
export class UninitPropsEl extends LitElement {
  @property({ type: String }) uninitStr?: string;
  @property({ type: Number }) uninitNum?: number;
  @property({ type: Boolean }) uninitBool?: boolean;
  @property({ type: String }) initStr = 'active';

  render() {
    return html\`<div>\${this.initStr}</div>\`;
  }
}
`;
      const res = transformNative(input);
      expect(res.vanillaCount).toBe(1);

      // Verify that uninitialized properties do NOT get assigned fabricated defaults in constructor
      expect(res.code).not.toContain('this._uninitStr = ""');
      expect(res.code).not.toContain('this._uninitNum = 0');
      expect(res.code).not.toContain('this._uninitBool = false');

      // But initialized property should preserve its default
      expect(res.code).toContain('this._initStr = "active"');
    });

    it('verifies zero over-classification of non-Lit classes (React and utility classes)', () => {
      const reactInput = `
import React from 'react';

export class MyReactComponent extends React.Component {
  render() {
    return React.createElement('div', null, 'hello');
  }
}
`;
      const ormInput = `
import { property } from './my-custom-orm.js';

export class NotLitModel {
  @property() id = 123;
  render() { return \`<div>\${this.id}</div>\`; }
}
`;
      // Verify non-Lit classes return empty classification (zero false positives)
      const reactClassified = classify(reactInput);
      expect(reactClassified).toHaveLength(0);

      const ormClassified = classify(ormInput);
      expect(ormClassified).toHaveLength(0);

      const reactTransformed = transformNative(reactInput);
      expect(reactTransformed.vanillaCount).toBe(0);
      expect(reactTransformed.microCount).toBe(0);

      const ormTransformed = transformNative(ormInput);
      expect(ormTransformed.vanillaCount).toBe(0);
      expect(ormTransformed.microCount).toBe(0);
    });

    it('handles aliased Lit imports correctly', () => {
      const input = `
import { LitElement as BaseElement, html as litHtml } from 'lit';
import { customElement as ce, property as prop } from 'lit/decorators.js';

@ce('aliased-el')
export class AliasedEl extends BaseElement {
  @prop({ type: String }) name = 'world';

  render() {
    return litHtml\`<div>Hello \${this.name}</div>\`;
  }
}
`;
      const classification = classify(input);
      expect(classification).toHaveLength(1);
      expect(classification[0].mode).toBe('vanilla');
      expect(classification[0].componentName).toBe('AliasedEl');

      const res = transformNative(input);
      expect(res.vanillaCount).toBe(1);
      expect(res.code).toContain('class AliasedEl extends HTMLElement');
      expect(res.code).toContain('customElements.define("aliased-el", AliasedEl)');
    });

    it('verifies clean bailout on dynamic tag name and dynamic attribute name expressions', () => {
      // 1. Dynamic tag name expression
      const dynTagInput = `
import { LitElement, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';

@customElement('dyn-tag-el')
export class DynTagEl extends LitElement {
  @property() myTag = 'h1';
  render() { return html\`<\${this.myTag}>Header</\${this.myTag}>\`; }
}
`;
      const dynTagRes = transformNative(dynTagInput);
      // Clean bailout: vanillaCount is 0, code left intact, zero broken markup
      expect(dynTagRes.vanillaCount).toBe(0);
      expect(dynTagRes.code).not.toContain('__lit_exp_');
      expect(dynTagRes.code).not.toContain('setAttribute("",');

      // 2. Dynamic attribute name expression
      const dynAttrInput = `
import { LitElement, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';

@customElement('dyn-attr-el')
export class DynAttrEl extends LitElement {
  @property() attrName = 'data-custom';
  render() { return html\`<div \${this.attrName}="val">Content</div>\`; }
}
`;
      const dynAttrRes = transformNative(dynAttrInput);
      // Clean bailout: vanillaCount is 0, code left intact, zero invalid setAttribute calls
      expect(dynAttrRes.vanillaCount).toBe(0);
      expect(dynAttrRes.code).not.toContain('setAttribute("div"');
    });
  });
});
