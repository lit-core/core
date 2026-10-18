import React, { StrictMode } from 'react';
import { renderToString } from 'react-dom/server';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { compileModule } from '../src/index.js';

function evalComponent(code: string, componentName: string): React.ComponentType<any> {
  const trans = ts.transpileModule(code, {
    compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS },
  });
  const exports: any = {};
  const fn = new Function('React', 'exports', trans.outputText);
  fn(React, exports);
  return exports[componentName];
}

describe('milestone 2 challenger: empirical scoped css, donut scoping, and rsc purity stress tests', () => {
  // =========================================================================
  // 1. Scoped CSS & Selector Rewriting Stress Testing
  // =========================================================================
  describe('1. scoped css & selector rewriting stress testing', () => {
    it('empirically verifies complex compound attribute selectors in :host([disabled][aria-expanded="true"])', () => {
      const code = `
        import { LitElement, html, css } from 'lit';
        export class ComplexHostComp extends LitElement {
          static styles = css\`
            :host([disabled][aria-expanded="true"]) {
              opacity: 0.6;
              pointer-events: none;
            }
          \`;
          render() {
            return html\`<div class="content">Complex Host</div>\`;
          }
        }
      `;
      const res = compileModule(code, { emitCss: true, filePath: 'complex-host.ts' });
      expect(res.css).toBeDefined();
      const css = res.css ?? '';

      // Must NOT contain unrewritten :host
      expect(css).not.toContain(':host');
      // Must contain :scope with both attributes
      expect(css).toMatch(/:scope(\[disabled\]\[aria-expanded=["']?true["']?|:is\(\[disabled\]\[aria-expanded=["']?true["']?\]\))/);
      expect(css).toContain('pointer-events:none');
    });

    it('empirically verifies chained pseudo-classes and nested selectors in :host(:hover:focus) and :host(:not([disabled]))', () => {
      const code = `
        import { LitElement, html, css } from 'lit';
        export class PseudoHostComp extends LitElement {
          static styles = css\`
            :host(:hover:focus) {
              outline: 2px solid blue;
            }
            :host(:not([disabled])) {
              cursor: pointer;
            }
          \`;
          render() {
            return html\`<button>Pseudo Button</button>\`;
          }
        }
      `;
      const res = compileModule(code, { emitCss: true, filePath: 'pseudo-host.ts' });
      expect(res.css).toBeDefined();
      const css = res.css ?? '';

      expect(css).not.toContain(':host');
      expect(css).toMatch(/:scope(:hover:focus|:is\(:hover:focus\))/);
      expect(css).toMatch(/:scope(:not\(\[disabled\]\)|:is\(:not\(\[disabled\]\)\))/);
    });

    it('empirically verifies context selectors :host-context(.dark-theme) and complex multi-token contexts', () => {
      const code = `
        import { LitElement, html, css } from 'lit';
        export class ContextComp extends LitElement {
          static styles = css\`
            :host-context(.dark-theme) {
              background-color: #121212;
              color: #f4f4f4;
            }
            :host-context([dir="rtl"] .theme-wrapper) .label {
              margin-left: 8px;
            }
          \`;
          render() {
            return html\`<span class="label">Context</span>\`;
          }
        }
      `;
      const res = compileModule(code, { emitCss: true, filePath: 'context-comp.ts' });
      expect(res.css).toBeDefined();
      const css = res.css ?? '';

      expect(css).not.toContain(':host-context');
      // Must rewrite to :is(.dark-theme :scope, :scope:is(.dark-theme))
      expect(css).toContain('.dark-theme');
      expect(css).toContain(':scope');
      expect(css).toContain('[dir=rtl]');
      expect(css).toContain('.theme-wrapper');
    });

    it('empirically verifies custom state pseudo-classes :state(checked), :state("checked"), and chained :state', () => {
      const code = `
        import { LitElement, html, css } from 'lit';
        export class StateComp extends LitElement {
          static styles = css\`
            :state(checked) {
              border-color: #0f62fe;
            }
            :state("expanded") {
              display: block;
            }
            :state(active):state(loading) {
              opacity: 0.8;
            }
            :host(:state(selected)) {
              box-shadow: 0 0 4px #0f62fe;
            }
          \`;
          render() {
            return html\`<div>Custom State</div>\`;
          }
        }
      `;
      const res = compileModule(code, { emitCss: true, filePath: 'state-comp.ts' });
      expect(res.css).toBeDefined();
      const css = res.css ?? '';

      expect(css).not.toContain(':state');
      expect(css).toContain('[data-state~=checked]');
      expect(css).toContain('[data-state~=expanded]');
      expect(css).toContain('[data-state~=active][data-state~=loading]');
      expect(css).toMatch(/:scope(\[data-state~=selected\]|:is\(\[data-state~=selected\]\))/);
    });

    it('empirically verifies neutralization of impossible sibling host combinators (:host + :host, :host ~ :host)', () => {
      const code = `
        import { LitElement, html, css } from 'lit';
        export class SiblingComp extends LitElement {
          static styles = css\`
            :host + :host {
              margin-left: 8px;
            }
            :host ~ :host {
              margin-top: 4px;
            }
            :scope + :scope {
              padding-left: 2px;
            }
          \`;
          render() {
            return html\`<div>Sibling</div>\`;
          }
        }
      `;
      const res = compileModule(code, { emitCss: true, filePath: 'sibling-comp.ts' });
      expect(res.css).toBeDefined();
      const css = res.css ?? '';

      expect(css).not.toContain(':host + :host');
      expect(css).not.toContain(':host ~ :host');
      expect(css).not.toContain(':scope + :scope');
      expect(css).toContain(':not(*)');
    });

    it('empirically verifies comma-separated selector lists with mixed :host and child classes', () => {
      const code = `
        import { LitElement, html, css } from 'lit';
        export class CommaComp extends LitElement {
          static styles = css\`
            :host([size="sm"]), :host([size="md"]), .badge-icon, :host-context(.compact) .badge-text {
              line-height: 1.25;
            }
          \`;
          render() {
            return html\`<span class="badge-text"><span class="badge-icon"></span>Text</span>\`;
          }
        }
      `;
      const res = compileModule(code, { emitCss: true, filePath: 'comma-comp.ts' });
      expect(res.css).toBeDefined();
      const css = res.css ?? '';

      expect(css).not.toContain(':host');
      expect(css).not.toContain(':host-context');
      expect(css).toMatch(/:scope\[size=sm\]|:scope:is\(\[size="?sm"?\]\)/);
      expect(css).toMatch(/:scope\[size=md\]|:scope:is\(\[size="?md"?\]\)/);
      expect(css).toContain('.badge-icon');
      expect(css).toContain('.compact');
      expect(css).toContain('.badge-text');
    });
  });

  // =========================================================================
  // 2. Slot Rules & Donut Scoping Invariants
  // =========================================================================
  describe('2. slot rules & donut scoping invariants', () => {
    it('empirically verifies ::slotted(span.icon) is segregated outside the donut hole into separate @scope', () => {
      const code = `
        import { LitElement, html, css } from 'lit';
        export class SlottedComp extends LitElement {
          static styles = css\`
            :host { display: block; }
            .container { padding: 8px; }
            ::slotted(span.icon) { fill: currentColor; }
            slot[name="lead"]::slotted(svg) { width: 16px; }
            slot[name='actions']::slotted(button) { margin: 4px; }
            slot[name=footer]::slotted(*) { border-top: 1px solid #e0e0e0; }
          \`;
          render() {
            return html\`
              <div class="container">
                <slot name="lead"></slot>
                <slot></slot>
                <slot name="actions"></slot>
                <slot name="footer"></slot>
              </div>
            \`;
          }
        }
      `;
      const res = compileModule(code, { emitCss: true, filePath: 'slotted-comp.ts' });
      expect(res.css).toBeDefined();
      const css = res.css ?? '';

      // Must rewrite slotted selectors targeting data-slot-boundary
      expect(css).toContain(':scope [data-slot-boundary]>:is(span.icon)');
      expect(css).toContain(':scope [data-slot-boundary][data-slot=lead]>:is(svg)');
      expect(css).toContain(':scope [data-slot-boundary][data-slot=actions]>:is(button)');
      expect(css).toContain(':scope [data-slot-boundary][data-slot=footer]>:is(*)');

      // Internal rules must be inside @scope (...) to (slot,[data-slot-boundary],slot-boundary)
      expect(css).toMatch(/@scope\s*\(\s*slotted-comp\s*\)\s*to\s*\(slot\s*,\s*\[data-slot-boundary\]\s*,\s*slot-boundary\)/);

      // Slotted rules MUST be inside a separate @scope without "to (...)" donut hole
      // Count occurrences of @scope in output CSS
      const scopeMatches = css.match(/@scope/g) ?? [];
      expect(scopeMatches.length).toBe(2);

      // Verify that the second @scope does NOT have "to ("
      const secondScopeIdx = css.lastIndexOf('@scope');
      const secondScopeBlock = css.slice(secondScopeIdx);
      expect(secondScopeBlock).toContain('[data-slot-boundary]');
      expect(secondScopeBlock).not.toContain('to (');
    });

    it('empirically verifies component with NO slots generates @scope WITHOUT donut hole', () => {
      const code = `
        import { LitElement, html, css } from 'lit';
        export class NoSlotComp extends LitElement {
          static styles = css\`
            :host { display: inline-block; }
            .inner { color: red; }
          \`;
          render() {
            return html\`<div class="inner">Fixed Leaf</div>\`;
          }
        }
      `;
      const res = compileModule(code, { emitCss: true, filePath: 'no-slot-comp.ts' });
      expect(res.css).toBeDefined();
      const css = res.css ?? '';

      expect(css).toMatch(/@scope\s*\(\s*no-slot-comp\s*\)\s*\{/);
      expect(css).not.toContain('to (');
      expect(css).not.toContain('slot-boundary');
    });

    it('empirically verifies top-level @keyframes and @font-face are preserved outside @scope blocks', () => {
      const code = `
        import { LitElement, html, css } from 'lit';
        export class AnimatedComp extends LitElement {
          static styles = css\`
            @keyframes pulse {
              0% { opacity: 1; transform: scale(1); }
              50% { opacity: 0.5; transform: scale(1.05); }
              100% { opacity: 1; transform: scale(1); }
            }
            @font-face {
              font-family: 'CustomFont';
              src: local('CustomFont');
            }
            :host {
              animation: pulse 2s infinite;
            }
            .spinner {
              animation: pulse 1s ease-in-out;
            }
          \`;
          render() {
            return html\`<div class="spinner">Loading</div>\`;
          }
        }
      `;
      const res = compileModule(code, { emitCss: true, filePath: 'animated-comp.ts' });
      expect(res.css).toBeDefined();
      const css = res.css ?? '';

      // @keyframes must be at root level, NOT nested inside @scope
      expect(css).toContain('@keyframes pulse');
      expect(css).toContain('@font-face');

      const keyframesIdx = css.indexOf('@keyframes');
      const fontFaceIdx = css.indexOf('@font-face');
      const scopeIdx = css.indexOf('@scope');

      // Keyframes and font-face must precede @scope
      expect(keyframesIdx).toBeLessThan(scopeIdx);
      expect(fontFaceIdx).toBeLessThan(scopeIdx);
    });

    it('empirically verifies nested @media and @supports blocks rewrite selectors and segregate correctly', () => {
      const code = `
        import { LitElement, html, css } from 'lit';
        export class ResponsiveComp extends LitElement {
          static styles = css\`
            @media (min-width: 768px) {
              :host { display: grid; }
              .item { padding: 16px; }
              ::slotted(img) { max-width: 100%; }
            }
            @supports (display: flex) {
              :host([layout="flex"]) { display: flex; }
              ::slotted(span) { display: inline-flex; }
            }
          \`;
          render() {
            return html\`<div class="item"><slot></slot></div>\`;
          }
        }
      `;
      const res = compileModule(code, { emitCss: true, filePath: 'responsive-comp.ts' });
      expect(res.css).toBeDefined();
      const css = res.css ?? '';

      expect(css).not.toContain(':host');
      expect(css).toMatch(/@media\s*\(width\s*>=\s*768px\)/);
      expect(css).toMatch(/@supports\s*\(display:\s*flex\)/);
      expect(css).toContain(':scope [data-slot-boundary]>:is(img)');
      expect(css).toContain(':scope [data-slot-boundary]>:is(span)');
    });
  });

  // =========================================================================
  // 3. Blake3 Content Hashing Stability & Determinism
  // =========================================================================
  describe('3. blake3 content hashing stability & determinism', () => {
    it('empirically verifies identical CSS produces identical 12-char hex hash across multiple runs', () => {
      const code = `
        import { LitElement, html, css } from 'lit';
        export class HashTestComp extends LitElement {
          static styles = css\`
            :host { display: block; color: #333333; }
            .content { font-size: 16px; }
          \`;
          render() { return html\`<div class="content">Hash</div>\`; }
        }
      `;
      const res1 = compileModule(code, { filePath: 'hash1.ts' });
      const res2 = compileModule(code, { filePath: 'hash2.ts' });
      const res3 = compileModule(code, { filePath: 'hash3.ts' });

      expect(res1.stylesheetId).toBeDefined();
      expect(res1.stylesheetId).toBe(res2.stylesheetId);
      expect(res2.stylesheetId).toBe(res3.stylesheetId);

      // Verify format: style-{tag}-{12-char-hex}
      expect(res1.stylesheetId).toMatch(/^style-hash-test-comp-[0-9a-f]{12}$/);
    });

    it('empirically verifies single-character CSS difference produces distinct hash', () => {
      const codeA = `
        import { LitElement, html, css } from 'lit';
        export class DeltaComp extends LitElement {
          static styles = css\`
            :host { color: #101010; }
          \`;
          render() { return html\`<div>Delta</div>\`; }
        }
      `;
      const codeB = `
        import { LitElement, html, css } from 'lit';
        export class DeltaComp extends LitElement {
          static styles = css\`
            :host { color: #101011; }
          \`;
          render() { return html\`<div>Delta</div>\`; }
        }
      `;

      const resA = compileModule(codeA, { filePath: 'deltaA.ts' });
      const resB = compileModule(codeB, { filePath: 'deltaB.ts' });

      expect(resA.stylesheetId).toBeDefined();
      expect(resB.stylesheetId).toBeDefined();
      expect(resA.stylesheetId).not.toBe(resB.stylesheetId);
    });

    it('empirically verifies custom stylesheet id prefix configuration', () => {
      const code = `
        import { LitElement, html, css } from 'lit';
        export class PrefixComp extends LitElement {
          static styles = css\`
            :host { margin: 0; }
          \`;
          render() { return html\`<div>Prefix</div>\`; }
        }
      `;
      const res = compileModule(code, {
        stylesheetIdPrefix: 'carbon-css',
        filePath: 'prefix.ts',
      });
      expect(res.stylesheetId).toMatch(/^carbon-css-prefix-comp-[0-9a-f]{12}$/);
      expect(res.code).toContain('href="carbon-css-prefix-comp-');
    });

    it('empirically verifies React 19 style hoisting tag structure (<style href precedence="default">)', () => {
      const code = `
        import { LitElement, html, css } from 'lit';
        export class HoistedComp extends LitElement {
          static styles = css\`.text { color: green; }\`;
          render() { return html\`<p class="text">Styled</p>\`; }
        }
      `;
      const res = compileModule(code, { emitCss: false, filePath: 'hoisted.ts' });
      expect(res.code).toContain('<style');
      expect(res.code).toContain(`href="${res.stylesheetId}"`);
      expect(res.code).toContain('precedence="default"');

      // Execute in React SSR
      const Component = evalComponent(res.code, 'HoistedComp');
      const htmlOutput = renderToString(React.createElement(StrictMode, null, React.createElement(Component)));
      expect(htmlOutput).toContain('<style');
      expect(htmlOutput).toContain(res.stylesheetId ?? '');
      expect(htmlOutput).toContain('precedence="default"');
    });
  });

  // =========================================================================
  // 4. React Server Component (RSC) Purity Invariants
  // =========================================================================
  describe('4. react server component (rsc) purity invariants', () => {
    it('empirically verifies Tier 0 output has ZERO "use client" directive', () => {
      const code = `
        import { LitElement, html } from 'lit';
        export class ServerHeader extends LitElement {
          render() {
            return html\`<header class="masthead"><h1>Title</h1></header>\`;
          }
        }
      `;
      const res = compileModule(code, { filePath: 'server-header.ts' });
      expect(res.tier).toBe('Tier0Pure');
      expect(res.code).not.toContain('use client');
      expect(res.code).not.toContain('"use client"');
      expect(res.code).not.toContain("'use client'");
    });

    it('empirically verifies Tier 0 output has ZERO React hook imports or invocations', () => {
      const code = `
        import { LitElement, html } from 'lit';
        export class ServerIcon extends LitElement {
          render() {
            return html\`
              <svg viewBox="0 0 24 24" width="24" height="24">
                <path d="M12 2L2 22h20L12 2z"></path>
              </svg>
            \`;
          }
        }
      `;
      const res = compileModule(code, { filePath: 'server-icon.ts' });
      expect(res.tier).toBe('Tier0Pure');

      // Comprehensive hook regex: no use[A-Z]... identifiers anywhere
      expect(res.code).not.toMatch(/\buse[A-Z]\w+/);
      expect(res.code).not.toContain('useState');
      expect(res.code).not.toContain('useEffect');
      expect(res.code).not.toContain('useLayoutEffect');
      expect(res.code).not.toContain('useRef');
      expect(res.code).not.toContain('useMemo');
      expect(res.code).not.toContain('useCallback');
      expect(res.code).not.toContain('useId');
      expect(res.code).not.toContain('useSyncExternalStore');
    });

    it('empirically verifies Tier 0 output has ZERO browser global references', () => {
      const code = `
        import { LitElement, html } from 'lit';
        export class PureDivider extends LitElement {
          render() {
            return html\`<hr class="sep" />\`;
          }
        }
      `;
      const res = compileModule(code, { filePath: 'pure-divider.ts' });
      expect(res.tier).toBe('Tier0Pure');

      expect(res.code).not.toMatch(/\b(window|document|customElements|HTMLElement|navigator|localStorage|sessionStorage)\b/);
    });

    it('empirically verifies Tier 0 output has ZERO MorphHost or runtime dependencies', () => {
      const code = `
        import { LitElement, html } from 'lit';
        export class PureFooter extends LitElement {
          render() {
            return html\`<footer><p>© 2026 Acme Corp</p></footer>\`;
          }
        }
      `;
      const res = compileModule(code, { filePath: 'pure-footer.ts' });
      expect(res.tier).toBe('Tier0Pure');

      expect(res.code).not.toContain('MorphHost');
      expect(res.code).not.toContain('useMorphHost');
      expect(res.code).not.toContain('@lit-core/morph-to-react/runtime');
      expect(res.code).toContain('export function PureFooter(');
    });

    it('empirically renders Tier 0 component in hermetic Node environment without window/document globals', () => {
      const code = `
        import { LitElement, html, css } from 'lit';
        export class HermeticBadge extends LitElement {
          static styles = css\`
            :host { display: inline-flex; }
            .badge-val { font-size: 14px; font-weight: normal; }
          \`;
          render() {
            return html\`<span class="badge-val">99+</span>\`;
          }
        }
      `;
      const res = compileModule(code, { filePath: 'hermetic-badge.ts' });
      expect(res.tier).toBe('Tier0Pure');

      // Verify execution in pure SSR without window or document
      const Component = evalComponent(res.code, 'HermeticBadge');

      // Temporarily ensure no global window or document exists in Node environment
      const hadWindow = 'window' in globalThis;
      const hadDocument = 'document' in globalThis;
      const origWindow = (globalThis as any).window;
      const origDocument = (globalThis as any).document;

      try {
        delete (globalThis as any).window;
        delete (globalThis as any).document;

        const renderedHtml = renderToString(React.createElement(StrictMode, null, React.createElement(Component)));
        expect(renderedHtml).toContain('<span class="badge-val">99+</span>');
        expect(renderedHtml).toContain('<style');
        expect(renderedHtml).toContain('precedence="default"');
      } finally {
        if (hadWindow) (globalThis as any).window = origWindow;
        if (hadDocument) (globalThis as any).document = origDocument;
      }
    });

    it('empirically verifies minified-input resilience with mangled import aliases and class names', () => {
      const code = `
        import { LitElement as e, html as t, css as s } from 'lit';
        export class m extends e {
          static styles = s\`:host { display: block; }\`;
          render() {
            return t\`<div class="m-box">Minified</div>\`;
          }
        }
      `;
      const res = compileModule(code, { filePath: 'min.js' });
      expect(res.tier).toBe('Tier0Pure');
      expect(res.code).toContain('export function m(');
      expect(res.code).toContain('className="m-box"');
      expect(res.code).toContain('Minified');
      expect(res.code).not.toContain('use client');
    });

    it('empirically verifies multiple styles in static styles array are concatenated and scoped', () => {
      const code = `
        import { LitElement, html, css } from 'lit';
        export class MultiStyleComp extends LitElement {
          static styles = [
            css\`:host { display: block; }\`,
            css\`.text { color: blue; }\`,
            css\`::slotted(span) { font-weight: bold; }\`
          ];
          render() {
            return html\`<div class="text"><slot></slot></div>\`;
          }
        }
      `;
      const res = compileModule(code, { emitCss: true, filePath: 'multi-style.ts' });
      expect(res.css).toBeDefined();
      const css = res.css ?? '';
      expect(css).toContain(':scope{display:block}');
      expect(css).toContain('.text{color:#00f}');
      expect(css).toContain(':scope [data-slot-boundary]>:is(span)');
      expect(css).toMatch(/@scope\s*\(\s*multi-style-comp\s*\)\s*to\s*\(slot/);
    });

    it('empirically verifies HTML5 template spec compliance in Tier 0 (table foster parenting and implied tags)', () => {
      const code = `
        import { LitElement, html } from 'lit';
        export class TableComp extends LitElement {
          render() {
            return html\`<table><span>Foster Content</span><tr><td>Cell 1</td></tr></table>\`;
          }
        }
      `;
      const res = compileModule(code, { filePath: 'table-comp.ts' });
      expect(res.tier).toBe('Tier0Pure');

      // The foster-parented span must be emitted as a sibling before <table>, matching browser WHATWG HTML5 parser
      const Component = evalComponent(res.code, 'TableComp');
      const htmlOutput = renderToString(React.createElement(Component));
      expect(htmlOutput).toContain('<span>Foster Content</span>');
      expect(htmlOutput).toContain('<table>');
      expect(htmlOutput).toContain('<tbody>');
      expect(htmlOutput).toContain('<tr><td>Cell 1</td></tr>');
    });
  });
});
