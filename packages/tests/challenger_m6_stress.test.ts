import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { fuse } from '../css-fuse/src/index.js';
import { minifyEmbeddedCss } from '../css-minifier/src/index.js';
import { transformDirectives } from '../directives/src/index.js';
import { transformDirtyMask } from '../dirty-mask/src/index.js';
import { transformDomPaths } from '../dom-paths/src/index.js';
import { transformElemProxy } from '../elem-proxy/src/index.js';
import { transformEventHoist } from '../event-hoist/src/index.js';
import { minifyHtmlTemplates } from '../html-minifier/src/index.js';
import { transformMemoize } from '../memoize/src/index.js';
import { classify, transformNative } from '../native/src/index.js';
import { transformLitProps } from '../props-lower/src/index.js';
import { scanTags, transformTagShake } from '../tag-shake/src/index.js';

function prepareRunnableCode(code: string): string {
  return code
    .replace(/import [^;]+;/g, '')
    .replace(/export\s+default\s+/g, '')
    .replace(/export\s+class\s+/g, 'class ')
    .replace(/export\s+\{[^}]+\};?/g, '');
}

describe('empirical challenger m6 comprehensive stress battery', () => {
  // =========================================================================
  // SECTION 1: CROSS-CRATE COMPILER PIPELINE CHAINING
  // =========================================================================
  describe('cross-crate compiler pipeline chaining', () => {
    it('pipes props-lower into elem-proxy seamlessly', () => {
      const input = `
import { LitElement } from 'lit';
import { property, state, customElement } from 'lit/decorators.js';

@customElement('pipeline-el-1')
export class PipelineEl1 extends LitElement {
  @property({ type: String }) title = 'initial';
  @property({ type: Number }) count = 0;
  @state() active = false;
}
`;
      // Pass 1: props-lower
      const lowered = transformLitProps(input);
      expect(lowered.code).toContain('static properties');
      expect(lowered.code).not.toContain('@property');

      // Pass 2: elem-proxy on lowered code
      const proxied = transformElemProxy(lowered.code);
      expect(proxied.proxiedElementsCount).toBe(1);
      expect(proxied.elements[0].tagName).toBe('pipeline-el-1');
      expect(proxied.elements[0].properties).toContain('title');
      expect(proxied.elements[0].properties).toContain('count');
      expect(proxied.elements[0].properties).toContain('active');

      // Verify executable in JS sandbox
      class MockHTMLElement {
        isConnected = false;
      }
      class MockLitElement extends MockHTMLElement {
        static finalize() {}
      }
      let definedTag = '';
      let DefinedClass: any = null;
      const customElements = {
        define: (tag: string, cls: any) => {
          definedTag = tag;
          DefinedClass = cls;
        },
      };

      const runnable = prepareRunnableCode(proxied.code);
      const fn = new Function('HTMLElement', 'LitElement', 'customElements', runnable);
      fn(MockHTMLElement, MockLitElement, customElements);

      expect(definedTag).toBe('pipeline-el-1');
      expect(DefinedClass).not.toBeNull();
      const instance = new DefinedClass();
      // Deferred proxy stub does not run real constructor until connected
      expect(instance.title).toBeUndefined();
      expect(instance.count).toBeUndefined();

      // Verify non-throwing property mutations and storage
      instance.title = 'updated';
      instance.count = 42;
      expect(instance.title).toBe('updated');
      expect(instance.count).toBe(42);
    });

    it('pipes multi-pass pipeline: propsLower -> directives -> memoize -> eventHoist -> dirtyMask -> domPaths', () => {
      const input = `
import { LitElement, html } from 'lit';
import { property, customElement } from 'lit/decorators.js';
import { when } from 'lit/directives/when.js';
import { classMap } from 'lit/directives/class-map.js';

@customElement('multi-pass-el')
export class MultiPassEl extends LitElement {
  @property({ type: String }) status = 'active';
  @property({ type: Number }) val = 10;

  handleClick(e) {
    this.val++;
  }

  render() {
    const classes = classMap({ on: this.status === 'active', off: this.status !== 'active' });
    return html\`
      <div class=\${classes} @click=\${this.handleClick}>
        \${when(this.val > 5, () => html\`<span>High: \${this.val * 2}</span>\`, () => html\`<span>Low</span>\`)}
      </div>
    \`;
  }
}
`;

      // 1. props-lower
      const p1 = transformLitProps(input);
      expect(p1.code).toContain('static properties');

      // 2. directives
      const p2 = transformDirectives(p1.code);
      expect(p2.loweredCount).toBeGreaterThan(0);

      // 3. memoize
      const p3 = transformMemoize(p2.code);
      expect(typeof p3.code).toBe('string');

      // 4. event-hoist
      const p4 = transformEventHoist(p3.code);
      expect(typeof p4.code).toBe('string');

      // 5. dirty-mask
      const p5 = transformDirtyMask(p4.code);
      expect(typeof p5.code).toBe('string');

      // 6. dom-paths
      const p6 = transformDomPaths(p5.code);
      expect(typeof p6.code).toBe('string');

      // Verify resulting AST is syntactically valid JavaScript
      const runnable = prepareRunnableCode(p6.code);
      expect(() => {
        new Function('HTMLElement', 'LitElement', 'customElements', runnable);
      }).not.toThrow();
    });

    it('pipes lowered components into native classifier and transform', () => {
      const input = `
import { LitElement, html } from 'lit';
import { property, customElement } from 'lit/decorators.js';

@customElement('native-test-el')
export class NativeTestEl extends LitElement {
  @property({ type: String }) label = 'hello';

  render() {
    return html\`<button>\${this.label}</button>\`;
  }
}
`;
      const lowered = transformLitProps(input);
      const classifications = classify(lowered.code);
      expect(classifications.length).toBe(1);
      expect(classifications[0].componentName).toBe('NativeTestEl');

      const nativeRes = transformNative(lowered.code);
      expect(nativeRes.code).toBeDefined();
      expect(typeof nativeRes.code).toBe('string');
    });

    it('coexists css-fuse and props-lower across shared components', () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'challenger-m6-fuse-'));
      const f1 = path.join(tempDir, 'comp1.ts');
      const f2 = path.join(tempDir, 'comp2.ts');

      const code1 = `
import { LitElement, css } from 'lit';
import { property, customElement } from 'lit/decorators.js';

@customElement('fuse-prop-1')
export class FuseProp1 extends LitElement {
  static styles = css\`
    :host { display: block; box-sizing: border-box; }
    .shared-rule { color: #333; padding: 12px; }
  \`;
  @property({ type: String }) title = 'one';
}
`;
      const code2 = `
import { LitElement, css } from 'lit';
import { property, customElement } from 'lit/decorators.js';

@customElement('fuse-prop-2')
export class FuseProp2 extends LitElement {
  static styles = css\`
    :host { display: block; box-sizing: border-box; }
    .shared-rule { color: #333; padding: 12px; }
  \`;
  @property({ type: String }) title = 'two';
}
`;
      // Lower props first
      const lowered1 = transformLitProps(code1);
      const lowered2 = transformLitProps(code2);
      fs.writeFileSync(f1, lowered1.code);
      fs.writeFileSync(f2, lowered2.code);

      // Fuse styles
      const fuseRes = fuse({ files: [f1, f2], threshold: 2, virtualImports: true });
      expect(fuseRes.rewrittenFiles.length).toBe(2);
      expect(fuseRes.fusedSheets.length).toBeGreaterThan(0);

      // Clean up
      fs.rmSync(tempDir, { recursive: true, force: true });
    });
  });

  // =========================================================================
  // SECTION 2: MINIFICATION RESILIENCE WITH MANGLED IDENTIFIERS AND DECORATORS
  // =========================================================================
  describe('minification resilience with mangled identifiers and decorators', () => {
    it('handles single-letter mangled Lit imports and decorators in props-lower and elem-proxy', () => {
      const input = `
import { LitElement as _L } from 'lit';
import { property as _p, state as _s, customElement as _c, query as _q } from 'lit/decorators.js';

@_c('x-mngl-el')
export class _A extends _L {
  @_p({ type: String, reflect: !0, attribute: 'x-title' }) _t = 'val';
  @_s() _st = 1;
  @_q('#btn') _b;
}
`;
      const lowered = transformLitProps(input);
      expect(lowered.code).toContain('static properties');
      expect(lowered.code).toContain('_t:');
      expect(lowered.code).toContain('_st:');

      const proxied = transformElemProxy(lowered.code);
      expect(proxied.proxiedElementsCount).toBe(1);
      expect(proxied.elements[0].tagName).toBe('x-mngl-el');
      expect(proxied.elements[0].properties).toContain('_t');
      expect(proxied.elements[0].properties).toContain('_st');
    });

    it('handles transpiled decorators with aliased helper functions', () => {
      const input = `
import { LitElement as E } from 'lit';
import { property as P, customElement as C } from 'lit/decorators.js';

var __decorate = function(decorators, target, key, desc) {
  var d = decorators.length;
  for (var i = d - 1; i >= 0; i--) decorators[i](target, key, desc);
};

var El = class extends E {};
__decorate([P({ type: Number })], El.prototype, "cnt", void 0);
El = __decorate([C("mngl-dec-el")], El);
export { El };
`;
      const lowered = transformLitProps(input);
      expect(lowered.code).toBeDefined();
      expect(lowered.code).not.toContain('__decorate');
      expect(lowered.code).toContain('El.createProperty("cnt", { type: Number })');
      expect(lowered.code).toContain('customElements.define("mngl-dec-el", El)');
    });

    it('respects lexical scope shadowing: ignores non-Lit property and customElement functions', () => {
      const input = `
function property(opts) {
  return function(proto, key) {};
}
function customElement(tag) {
  return function(cls) { return cls; };
}

@customElement('foreign-fake-el')
export class ForeignFakeEl {
  @property({ type: String })
  fakeProp = 'hello';
}
`;
      // Since 'property' is a local function and not imported from Lit, props-lower must NOT treat it as Lit property
      const lowered = transformLitProps(input);
      expect(lowered.code).not.toContain('static properties');
      expect(lowered.code).toContain('@property');

      // elem-proxy must NOT proxy non-Lit elements
      const proxied = transformElemProxy(lowered.code);
      expect(proxied.proxiedElementsCount).toBe(0);
    });

    it('handles mangled directives with aliased imports and ignores shadowed locals', () => {
      const input = `
import { when as _w } from 'lit/directives/when.js';
import { html } from 'lit';

export function renderValid() {
  return html\`<div>\${_w(true, () => 'yes', () => 'no')}</div>\`;
}

export function renderShadowed() {
  const when = (cond, a, b) => 'shadowed';
  return html\`<div>\${when(true, 'a', 'b')}</div>\`;
}
`;
      const res = transformDirectives(input);
      expect(res.loweredCount).toBe(1);
      // _w must be lowered to ternary
      expect(res.code).toContain('true ?');
      // shadowed local when must remain untouched
      expect(res.code).toContain('when(true,');
    });

    it('enforces array purity invariants in memoize under mangled identifiers', () => {
      // In-place sort mutation: must be rejected
      const mutCode = `
import { LitElement, html } from 'lit';
export class MnglMutEl extends LitElement {
  render() {
    return html\`<div>\${this._items.sort()}</div>\`;
  }
}
`;
      const mutRes = transformMemoize(mutCode);
      expect(mutRes.memoizedCount).toBe(0);

      // Safe clone and sort: accepted
      const safeCode = `
import { LitElement, html } from 'lit';
export class MnglSafeEl extends LitElement {
  render() {
    return html\`<div>\${this._items.slice().sort()}</div>\`;
  }
}
`;
      const safeRes = transformMemoize(safeCode);
      expect(safeRes.memoizedCount).toBe(1);
    });

    it('safely bails out on dynamic and unmergeable static properties without crashing', () => {
      const input = `
import { LitElement } from 'lit';
import { property } from 'lit/decorators.js';

export class DynamicPropsEl extends LitElement {
  static properties = getDynamicProperties();
  @property({ type: String }) extraProp = 'value';
}
`;
      const res = transformLitProps(input);
      // Safe bailout: leaves code intact or preserves static properties safely
      expect(res.code).toContain('static properties = getDynamicProperties()');
    });

    it('prunes dead custom elements and preserves used ones under tag-shake', () => {
      const appCode = `
import { html } from 'lit';
export const view = html\`<used-el></used-el>\`;
`;
      const tags = scanTags(appCode);
      expect(tags).toContain('used-el');
      expect(tags).not.toContain('unused-el');

      const libraryCode = `
import { LitElement } from 'lit';
export class UsedEl extends LitElement {}
customElements.define('used-el', UsedEl);

export class UnusedEl extends LitElement {}
customElements.define('unused-el', UnusedEl);
`;
      const shaken = transformTagShake(libraryCode, { usedTags: ['used-el'] });
      expect(shaken.preservedTags).toContain('used-el');
      expect(shaken.removedTags).toContain('unused-el');
      expect(shaken.code).toContain('customElements.define("used-el"');
      expect(shaken.code).not.toContain('customElements.define("unused-el"');
    });

    it('minifies embedded HTML and CSS template literals without corrupting syntax', () => {
      const htmlInput = `
import { html } from 'lit';
export const tpl = html\`
  <!-- comment that should be stripped -->
  <div   class="container"   data-val="123"  >
    <span>\${"hello"}</span>
  </div>
\`;
`;
      const htmlRes = minifyHtmlTemplates(htmlInput);
      expect(htmlRes.bytesSaved).toBeGreaterThan(0);
      expect(htmlRes.code).not.toContain('<!-- comment that should be stripped -->');

      const cssInput = `
import { css } from 'lit';
export const styles = css\`
  /* css comment */
  :host {
    display: block;
    margin: 0px 0px 0px 0px;
  }
\`;
`;
      const cssRes = minifyEmbeddedCss(cssInput);
      expect(cssRes.bytesSaved).toBeGreaterThan(0);
      expect(cssRes.code).not.toContain('/* css comment */');
    });
  });

  // =========================================================================
  // SECTION 3: RUNTIME DOM AND PROXY EXECUTION SAFETY
  // =========================================================================
  describe('runtime DOM and proxy execution safety', () => {
    it('verifies elem-proxy prototype traversal, non-throwing property access, and deferred lifecycle', () => {
      const input = `
import { LitElement } from 'lit';
export class ComplexLifecycleEl extends LitElement {
  static properties = {
    title: { type: String },
    count: { type: Number },
    flag: { type: Boolean },
    data: { type: Object }
  };
}
customElements.define('complex-lifecycle-el', ComplexLifecycleEl);
`;
      const res = transformElemProxy(input);
      expect(res.proxiedElementsCount).toBe(1);

      class BaseHTMLElement {
        isConnected = false;
        addEventListener() {}
        removeEventListener() {}
      }
      class BaseLitElement extends BaseHTMLElement {
        static finalize() {}
      }

      let RegisteredClass: any = null;
      const customElements = {
        define: (_tag: string, cls: any) => {
          RegisteredClass = cls;
        },
      };

      const runnable = prepareRunnableCode(res.code);
      const fn = new Function('HTMLElement', 'LitElement', 'customElements', runnable);
      fn(BaseHTMLElement, BaseLitElement, customElements);

      expect(RegisteredClass).not.toBeNull();
      const instance = new RegisteredClass();

      // Read uninitialized properties (must not throw RangeError or TypeError)
      expect(instance.title).toBeUndefined();
      expect(instance.count).toBeUndefined();
      expect(instance.flag).toBeUndefined();
      expect(instance.data).toBeUndefined();

      // Write values before connection
      instance.title = 'Hello World';
      instance.count = 999;
      instance.flag = true;
      instance.data = { key: 'value' };

      // Verify immediate readback
      expect(instance.title).toBe('Hello World');
      expect(instance.count).toBe(999);
      expect(instance.flag).toBe(true);
      expect(instance.data).toEqual({ key: 'value' });

      // Simulate connection when isConnected is false (guard check)
      instance.isConnected = false;
      if (typeof instance.connectedCallback === 'function') {
        expect(() => instance.connectedCallback()).not.toThrow();
      }

      // Simulate connection when isConnected is true
      instance.isConnected = true;
      if (typeof instance.connectedCallback === 'function') {
        expect(() => instance.connectedCallback()).not.toThrow();
      }
    });

    it('handles deep prototype inheritance without infinite recursion or RangeError in elem-proxy', () => {
      const input = `
import { LitElement } from 'lit';
export class GrandParentEl extends LitElement {
  static properties = { gpProp: { type: String } };
}
export class ParentEl extends GrandParentEl {
  static properties = { pProp: { type: Number } };
}
export class ChildEl extends ParentEl {
  static properties = { cProp: { type: Boolean } };
}
customElements.define('child-el', ChildEl);
`;
      const res = transformElemProxy(input);
      expect(res.proxiedElementsCount).toBe(1);

      class MockHTMLElement {
        isConnected = false;
      }
      class MockLitElement extends MockHTMLElement {
        static finalize() {}
      }

      let ChildClass: any = null;
      const customElements = {
        define: (_tag: string, cls: any) => {
          ChildClass = cls;
        },
      };

      const runnable = prepareRunnableCode(res.code);
      const fn = new Function('HTMLElement', 'LitElement', 'customElements', runnable);
      fn(MockHTMLElement, MockLitElement, customElements);

      expect(ChildClass).not.toBeNull();
      const instance = new ChildClass();

      // Ensure setting property does not trigger infinite prototype recursion
      expect(() => {
        instance.cProp = true;
      }).not.toThrow();
      expect(instance.cProp).toBe(true);
    });

    it('handles multi-template rendering in dom-paths and dirty-mask', () => {
      const input = `
import { LitElement, html } from 'lit';
import { property, customElement } from 'lit/decorators.js';

@customElement('multi-tpl-el')
export class MultiTplEl extends LitElement {
  @property({ type: String }) title = 'lit';
  @property({ type: Number }) count = 0;

  renderHeader() {
    return html\`<h1>\${this.title}</h1>\`;
  }

  render() {
    return html\`
      <div class="wrapper">
        \${this.renderHeader()}
        <span>Count: \${this.count}</span>
      </div>
    \`;
  }
}
`;
      // Lower properties
      const lowered = transformLitProps(input);
      // Dirty mask
      const masked = transformDirtyMask(lowered.code);
      expect(masked.code).toBeDefined();
      // DOM paths
      const pathsRes = transformDomPaths(masked.code);
      expect(pathsRes.code).toBeDefined();
      expect(typeof pathsRes.code).toBe('string');
    });

    it('handles advanced directives: classMap, styleMap, and when combinations', () => {
      const input = `
import { LitElement, html } from 'lit';
import { classMap } from 'lit/directives/class-map.js';
import { styleMap } from 'lit/directives/style-map.js';
import { when } from 'lit/directives/when.js';

export class AdvancedDirectivesEl extends LitElement {
  render() {
    const classes = classMap({ active: true, hidden: false });
    const styles = styleMap({ color: 'red', display: 'flex' });
    return html\`
      <div class=\${classes} style=\${styles}>
        \${when(true, () => html\`<span>Visible</span>\`)}
      </div>
    \`;
  }
}
`;
      const res = transformDirectives(input);
      expect(res.loweredCount).toBeGreaterThan(0);
      expect(res.code).toBeDefined();
    });
  });
});
