import React from 'react';
import { renderToString } from 'react-dom/server';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import * as morphRuntime from '../runtime/index.js';
import { compileModule } from '../src/index.js';

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

describe('milestone 5 wave 3 challenger: empirical deep stress testing of slots, branches & sub-templates', () => {
  // =========================================================================
  // 1. Complex conditional branches & isolation
  // =========================================================================
  describe('1. complex conditional branches & isolation', () => {
    it('empirically verifies when directive without false-case fallback yields null when falsy', () => {
      const code = `
        import { LitElement, html, property } from 'lit';
        import { when } from 'lit/directives/when.js';

        export class WhenNoFalseCaseHost extends LitElement {
          @property({ type: Boolean })
          active = false;

          render() {
            return html\`
              <div class="shell">
                \${when(this.active, () => html\`<span class="active-tag">Active</span>\`)}
              </div>
            \`;
          }
        }
      `;

      const res = compileModule(code, { filePath: 'when-no-false.ts' });
      expect(res.code).not.toContain('html`<span');
      const WhenNoFalseCaseHost = evalComponent(res.code, 'WhenNoFalseCaseHost');

      // False state: should render empty div without active-tag
      const falsyHtml = stripComments(renderToString(React.createElement(WhenNoFalseCaseHost, { active: false })));
      expect(falsyHtml).toContain('class="shell"');
      expect(falsyHtml).not.toContain('active-tag');

      // True state: should render active-tag
      const truthyHtml = stripComments(renderToString(React.createElement(WhenNoFalseCaseHost, { active: true })));
      expect(truthyHtml).toContain('class="shell"');
      expect(truthyHtml).toContain('active-tag');
      expect(truthyHtml).toContain('Active');
    });

    it('empirically verifies ternary branches returning nothing or null lower properly to null', () => {
      const code = `
        import { LitElement, html, property, nothing } from 'lit';

        export class NothingBranchHost extends LitElement {
          @property({ type: Boolean })
          showBanner = false;

          render() {
            return html\`
              <div class="container">
                \${this.showBanner
                  ? html\`<div class="banner"><slot name="banner"><span>Default Banner</span></slot></div>\`
                  : nothing}
              </div>
            \`;
          }
        }
      `;

      const res = compileModule(code, { filePath: 'nothing-branch.ts' });
      expect(res.code).not.toContain('html`<div class="banner">');
      const NothingBranchHost = evalComponent(res.code, 'NothingBranchHost');

      // False state: renders nothing (null in JSX)
      const htmlF = stripComments(renderToString(React.createElement(NothingBranchHost, { showBanner: false })));
      expect(htmlF).toContain('class="container"');
      expect(htmlF).not.toContain('banner');
      expect(htmlF).not.toContain('Default Banner');

      // True state: renders banner with fallback or projected child
      const htmlT = stripComments(renderToString(React.createElement(NothingBranchHost, { showBanner: true })));
      expect(htmlT).toContain('banner');
      expect(htmlT).toContain('Default Banner');

      const htmlProjected = stripComments(renderToString(React.createElement(NothingBranchHost, { showBanner: true }, React.createElement('span', { slot: 'banner' }, 'Projected Banner'))));
      expect(htmlProjected).toContain('Projected Banner');
      expect(htmlProjected).not.toContain('Default Banner');
    });

    it('empirically verifies 4-way deeply nested ternaries across both branches isolate slots', () => {
      const code = `
        import { LitElement, html, property } from 'lit';

        export class FourWayDeepTernaryHost extends LitElement {
          @property({ type: Boolean })
          condA = false;

          @property({ type: Boolean })
          condB = false;

          render() {
            return html\`
              <div class="grid">
                \${this.condA
                  ? (this.condB
                      ? html\`<div class="cell-a-b"><slot name="tag"><span>Tag A-B</span></slot></div>\`
                      : html\`<div class="cell-a-notb"><slot name="tag"><span>Tag A-notB</span></slot></div>\`)
                  : (this.condB
                      ? html\`<div class="cell-nota-b"><slot name="tag"><span>Tag notA-B</span></slot></div>\`
                      : html\`<div class="cell-nota-notb"><slot name="tag"><span>Tag notA-notB</span></slot></div>\`)}
              </div>
            \`;
          }
        }
      `;

      const res = compileModule(code, { filePath: 'four-way-deep-ternary.ts' });
      const FourWayDeepTernaryHost = evalComponent(res.code, 'FourWayDeepTernaryHost');

      const configs = [
        { condA: true, condB: true, expectedClass: 'cell-a-b', fb: 'Tag A-B' },
        { condA: true, condB: false, expectedClass: 'cell-a-notb', fb: 'Tag A-notB' },
        { condA: false, condB: true, expectedClass: 'cell-nota-b', fb: 'Tag notA-B' },
        { condA: false, condB: false, expectedClass: 'cell-nota-notb', fb: 'Tag notA-notB' },
      ];

      for (const cfg of configs) {
        // Fallback test
        const renderedFb = stripComments(renderToString(React.createElement(FourWayDeepTernaryHost, { condA: cfg.condA, condB: cfg.condB })));
        expect(renderedFb).toContain(cfg.expectedClass);
        expect(renderedFb).toContain(cfg.fb);

        // Projected slot test
        const renderedProj = stripComments(
          renderToString(React.createElement(FourWayDeepTernaryHost, { condA: cfg.condA, condB: cfg.condB }, React.createElement('span', { slot: 'tag' }, 'Custom Projected Tag'))),
        );
        expect(renderedProj).toContain(cfg.expectedClass);
        expect(renderedProj).toContain('Custom Projected Tag');
        expect(renderedProj).not.toContain(cfg.fb);
      }
    });

    it('empirically verifies mixed ternary with scalar string or number literal alternate', () => {
      const code = `
        import { LitElement, html, property } from 'lit';

        export class MixedTernaryHost extends LitElement {
          @property({ type: Boolean })
          hasDetails = false;

          render() {
            return html\`
              <div class="details-box">
                \${this.hasDetails ? html\`<span class="custom-details">Detailed Info</span>\` : "No details available"}
              </div>
            \`;
          }
        }
      `;

      const res = compileModule(code, { filePath: 'mixed-ternary.ts' });
      expect(res.code).not.toContain('html`<span');
      const MixedTernaryHost = evalComponent(res.code, 'MixedTernaryHost');

      const renderedF = stripComments(renderToString(React.createElement(MixedTernaryHost, { hasDetails: false })));
      expect(renderedF).toContain('No details available');
      expect(renderedF).not.toContain('custom-details');

      const renderedT = stripComments(renderToString(React.createElement(MixedTernaryHost, { hasDetails: true })));
      expect(renderedT).toContain('custom-details');
      expect(renderedT).toContain('Detailed Info');
      expect(renderedT).not.toContain('No details available');
    });

    it('empirically verifies parenthesized expressions in attribute holes, event bindings, and child holes', () => {
      const code = `
        import { LitElement, html, property } from 'lit';

        export class ParenAttributesHost extends LitElement {
          @property({ type: String })
          titleText = 'Greeting';

          @property({ type: Boolean })
          disabled = false;

          render() {
            return html\`
              <button
                class=\${('btn-' + (this.titleText))}
                ?disabled=\${((this.disabled))}
                aria-label=\${(this.titleText)}
              >
                \${(html\`<span class="btn-inner">\${(this.titleText)}</span>\`)}
              </button>
            \`;
          }
        }
      `;

      const res = compileModule(code, { filePath: 'paren-attributes.ts' });
      expect(res.code).not.toContain('html`<span class="btn-inner">');
      const ParenAttributesHost = evalComponent(res.code, 'ParenAttributesHost');

      const rendered = stripComments(renderToString(React.createElement(ParenAttributesHost, { titleText: 'Welcome', disabled: true })));
      expect(rendered).toContain('class="btn-Welcome"');
      expect(rendered).toContain('disabled');
      expect(rendered).toContain('aria-label="Welcome"');
      expect(rendered).toContain('class="btn-inner"');
      expect(rendered).toContain('Welcome</span>');
    });
  });

  // =========================================================================
  // 2. Sub-template class methods, getters, and arrow function properties
  // =========================================================================
  describe('2. sub-template class methods, getters, and arrow function properties', () => {
    it('empirically verifies sub-template methods with arguments lower and render properly', () => {
      const code = `
        import { LitElement, html } from 'lit';

        export class MethodWithArgsHost extends LitElement {
          renderBadge(label: string, count: number) {
            return html\`<span class="badge badge-\${label}">\${label}: \${count}</span>\`;
          }

          render() {
            return html\`
              <div class="badges-panel">
                \${this.renderBadge('alerts', 5)}
                \${this.renderBadge('notifs', 12)}
              </div>
            \`;
          }
        }
      `;

      const res = compileModule(code, { filePath: 'method-with-args.ts' });
      expect(res.code).not.toContain('html`<span class="badge');
      const MethodWithArgsHost = evalComponent(res.code, 'MethodWithArgsHost');

      const rendered = stripComments(renderToString(React.createElement(MethodWithArgsHost)));
      expect(rendered).toContain('badge-alerts');
      expect(rendered).toContain('alerts: 5');
      expect(rendered).toContain('badge-notifs');
      expect(rendered).toContain('notifs: 12');
    });

    it('empirically verifies sub-template method calling another sub-template method on this', () => {
      const code = `
        import { LitElement, html, property } from 'lit';

        export class ChainedSubMethodsHost extends LitElement {
          @property({ type: String })
          title = 'Default Title';

          renderIcon() {
            return html\`<svg class="icon"><circle cx="5" cy="5" r="5" /></svg>\`;
          }

          renderHeader() {
            return html\`
              <header class="card-header">
                \${this.renderIcon()}
                <h3 class="card-title">\${this.title}</h3>
                <slot name="extra">Extra Default</slot>
              </header>
            \`;
          }

          render() {
            return html\`
              <div class="card">
                \${this.renderHeader()}
                <div class="card-body"><slot>Body Default</slot></div>
              </div>
            \`;
          }
        }
      `;

      const res = compileModule(code, { filePath: 'chained-sub-methods.ts' });
      expect(res.code).not.toContain('html`<svg');
      expect(res.code).not.toContain('html`<header');
      const ChainedSubMethodsHost = evalComponent(res.code, 'ChainedSubMethodsHost');

      const rendered = stripComments(
        renderToString(
          React.createElement(ChainedSubMethodsHost, { title: 'My Super Card' }, React.createElement('span', { slot: 'extra' }, 'Custom Extra'), React.createElement('p', null, 'Custom Body Content')),
        ),
      );

      expect(rendered).toContain('class="card-header"');
      expect(rendered).toContain('<svg');
      expect(rendered).toContain('My Super Card');
      expect(rendered).toContain('Custom Extra');
      expect(rendered).not.toContain('Extra Default');
      expect(rendered).toContain('Custom Body Content');
      expect(rendered).not.toContain('Body Default');
    });

    it('empirically verifies host class getters returning templates lower to JSX', () => {
      const code = `
        import { LitElement, html } from 'lit';

        export class GetterTemplateHost extends LitElement {
          get headerSection() {
            return html\`<header class="getter-header"><slot name="header">Fallback Header</slot></header>\`;
          }

          render() {
            return html\`
              <div class="shell">
                \${this.headerSection}
                <main><slot>Fallback Main</slot></main>
              </div>
            \`;
          }
        }
      `;

      const res = compileModule(code, { filePath: 'getter-template.ts' });
      expect(res.code).not.toContain('html`<header class="getter-header">');
      const GetterTemplateHost = evalComponent(res.code, 'GetterTemplateHost');

      const rendered = stripComments(
        renderToString(React.createElement(GetterTemplateHost, null, React.createElement('span', { slot: 'header' }, 'Slotted Header'), React.createElement('p', null, 'Slotted Main'))),
      );

      expect(rendered).toContain('getter-header');
      expect(rendered).toContain('Slotted Header');
      expect(rendered).not.toContain('Fallback Header');
      expect(rendered).toContain('Slotted Main');
      expect(rendered).not.toContain('Fallback Main');
    });

    it('empirically verifies arrow function properties with arguments and conditional templates', () => {
      const code = `
        import { LitElement, html, property } from 'lit';

        export class ArrowPropArgsHost extends LitElement {
          @property({ type: Boolean })
          cond = false;

          renderAction = (label: string, primary: boolean) => {
            return html\`
              <button class=\${primary ? 'btn-primary' : 'btn-secondary'}>
                \${label}
              </button>
            \`;
          };

          render() {
            return html\`
              <div class="actions">
                \${this.renderAction('Confirm', this.cond)}
                \${this.renderAction('Cancel', false)}
              </div>
            \`;
          }
        }
      `;

      const res = compileModule(code, { filePath: 'arrow-prop-args.ts' });
      expect(res.code).not.toContain('html`<button');
      const ArrowPropArgsHost = evalComponent(res.code, 'ArrowPropArgsHost');

      const renderedT = stripComments(renderToString(React.createElement(ArrowPropArgsHost, { cond: true })));
      expect(renderedT).toContain('btn-primary');
      expect(renderedT).toContain('Confirm');
      expect(renderedT).toContain('btn-secondary');
      expect(renderedT).toContain('Cancel');

      const renderedF = stripComments(renderToString(React.createElement(ArrowPropArgsHost, { cond: false })));
      expect(renderedF).not.toContain('btn-primary');
      expect(renderedF).toContain('btn-secondary');
    });
  });

  // =========================================================================
  // 3. Slot / property disambiguation with isValidElement
  // =========================================================================
  describe('3. slot / property disambiguation with isValidElement', () => {
    it('empirically verifies declared properties with various scalar types never displace slot fallbacks', () => {
      const code = `
        import { LitElement, html, property } from 'lit';

        export class ScalarPropVsSlotHost extends LitElement {
          @property({ type: String })
          status = 'initial';

          @property({ type: Number })
          count = 0;

          @property({ type: Boolean })
          active = false;

          render() {
            return html\`
              <div class="panel">
                <div class="status-slot">
                  <slot name="status"><span>Status Fallback</span></slot>
                </div>
                <div class="count-slot">
                  <slot name="count"><span>Count Fallback</span></slot>
                </div>
                <div class="active-slot">
                  <slot name="active"><span>Active Fallback</span></slot>
                </div>
              </div>
            \`;
          }
        }
      `;

      const res = compileModule(code, { filePath: 'scalar-prop-vs-slot.ts' });
      expect(res.code).toContain('isValidElement');
      const ScalarPropVsSlotHost = evalComponent(res.code, 'ScalarPropVsSlotHost');

      // Test with string, number, boolean props provided
      const rendered = stripComments(
        renderToString(
          React.createElement(ScalarPropVsSlotHost, {
            status: 'running',
            count: 42,
            active: true,
          }),
        ),
      );

      // Scalar property values must NOT displace the slot fallbacks!
      expect(rendered).toContain('Status Fallback');
      expect(rendered).not.toContain('running</span>');
      expect(rendered).toContain('Count Fallback');
      expect(rendered).not.toContain('42</span>');
      expect(rendered).toContain('Active Fallback');
    });

    it('empirically verifies declared property with object or array values does not displace slot fallback', () => {
      const code = `
        import { LitElement, html, property } from 'lit';

        export class ObjectPropVsSlotHost extends LitElement {
          @property({ type: Object })
          config = null;

          @property({ type: Array })
          items = [];

          render() {
            return html\`
              <div>
                <slot name="config"><span>Config Fallback</span></slot>
                <slot name="items"><span>Items Fallback</span></slot>
              </div>
            \`;
          }
        }
      `;

      const res = compileModule(code, { filePath: 'object-prop-vs-slot.ts' });
      expect(res.code).toContain('isValidElement');
      const ObjectPropVsSlotHost = evalComponent(res.code, 'ObjectPropVsSlotHost');

      // Pass object and array as props
      const rendered = stripComments(
        renderToString(
          React.createElement(ObjectPropVsSlotHost, {
            config: { mode: 'prod' },
            items: ['alpha', 'beta'],
          }),
        ),
      );

      // Object/array are not valid React elements, so fallbacks must be preserved
      expect(rendered).toContain('Config Fallback');
      expect(rendered).toContain('Items Fallback');
    });

    it('empirically verifies declared property accepts React elements while slotted children override props', () => {
      const code = `
        import { LitElement, html, property } from 'lit';

        export class ElementPropVsSlottedChildHost extends LitElement {
          @property({ type: String })
          tag = 'default-tag';

          render() {
            return html\`
              <div class="tag-wrapper">
                <slot name="tag"><span>Default Tag Fallback</span></slot>
              </div>
            \`;
          }
        }
      `;

      const res = compileModule(code, { filePath: 'element-prop-vs-slotted.ts' });
      const ElementPropVsSlottedChildHost = evalComponent(res.code, 'ElementPropVsSlottedChildHost');

      // 1. Genuine React element passed as prop
      const renderedElemProp = stripComments(
        renderToString(
          React.createElement(ElementPropVsSlottedChildHost, {
            tag: React.createElement('em', { className: 'prop-tag' }, 'Prop Element Tag'),
          }),
        ),
      );
      expect(renderedElemProp).toContain('prop-tag');
      expect(renderedElemProp).toContain('Prop Element Tag');
      expect(renderedElemProp).not.toContain('Default Tag Fallback');

      // 2. Both React element prop AND slotted DOM child passed: DOM child must take precedence!
      const renderedBoth = stripComments(
        renderToString(
          React.createElement(
            ElementPropVsSlottedChildHost,
            { tag: React.createElement('em', { className: 'prop-tag' }, 'Prop Element Tag') },
            React.createElement('strong', { slot: 'tag', className: 'slotted-tag' }, 'Slotted Child Tag'),
          ),
        ),
      );
      expect(renderedBoth).toContain('slotted-tag');
      expect(renderedBoth).toContain('Slotted Child Tag');
      expect(renderedBoth).not.toContain('prop-tag');
      expect(renderedBoth).not.toContain('Prop Element Tag');
    });

    it('empirically verifies undeclared slot names preserve standard React prop precedence', () => {
      const code = `
        import { LitElement, html } from 'lit';

        export class UndeclaredSlotHost extends LitElement {
          render() {
            return html\`
              <div class="container">
                <slot name="customHeader"><span>Fallback Header</span></slot>
              </div>
            \`;
          }
        }
      `;

      const res = compileModule(code, { filePath: 'undeclared-slot.ts' });
      expect(res.code).not.toContain('isValidElement');
      const UndeclaredSlotHost = evalComponent(res.code, 'UndeclaredSlotHost');

      // Undeclared slot prop: simple text string passed via props.customHeader should be accepted
      const renderedTextProp = stripComments(renderToString(React.createElement(UndeclaredSlotHost, { customHeader: 'Plain String Header' })));
      expect(renderedTextProp).toContain('Plain String Header');
      expect(renderedTextProp).not.toContain('Fallback Header');

      // Slotted child takes precedence when no prop passed
      const renderedSlotted = stripComments(renderToString(React.createElement(UndeclaredSlotHost, null, React.createElement('h1', { slot: 'customHeader' }, 'Slotted H1 Header'))));
      expect(renderedSlotted).toContain('Slotted H1 Header');
    });
  });

  // =========================================================================
  // 4. Preceding statements in render()
  // =========================================================================
  describe('4. preceding statements in render()', () => {
    it('empirically verifies multiple local variables and array maps in render() lower to JSX', () => {
      const code = `
        import { LitElement, html, property } from 'lit';

        export class PrecedingStmtsMultiHost extends LitElement {
          @property({ type: Boolean })
          showFooter = false;

          render() {
            const iconTmpl = html\`<span class="icon">★</span>\`;
            const headingTmpl = html\`<h4 class="hdr">\${iconTmpl} Card Title</h4>\`;
            const items = ['one', 'two'].map((x, idx) => html\`<li key=\${idx} class="item">\${x}</li>\`);
            const footerTmpl = this.showFooter ? html\`<footer class="ftr">Footer</footer>\` : null;

            return html\`
              <div class="card">
                \${headingTmpl}
                <ul class="list">\${items}</ul>
                \${footerTmpl}
              </div>
            \`;
          }
        }
      `;

      const res = compileModule(code, { filePath: 'preceding-stmts-multi.ts' });
      expect(res.code).not.toContain('html`<span class="icon">');
      expect(res.code).not.toContain('html`<h4 class="hdr">');
      expect(res.code).not.toContain('html`<li');
      expect(res.code).not.toContain('html`<footer');

      const PrecedingStmtsMultiHost = evalComponent(res.code, 'PrecedingStmtsMultiHost');

      const renderedWithoutFtr = stripComments(renderToString(React.createElement(PrecedingStmtsMultiHost, { showFooter: false })));
      expect(renderedWithoutFtr).toContain('class="hdr"');
      expect(renderedWithoutFtr).toContain('★');
      expect(renderedWithoutFtr).toContain('Card Title');
      expect(renderedWithoutFtr).toContain('class="item">one</li>');
      expect(renderedWithoutFtr).toContain('class="item">two</li>');
      expect(renderedWithoutFtr).not.toContain('class="ftr"');

      const renderedWithFtr = stripComments(renderToString(React.createElement(PrecedingStmtsMultiHost, { showFooter: true })));
      expect(renderedWithFtr).toContain('class="ftr"');
      expect(renderedWithFtr).toContain('Footer');
    });
  });
});
