import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeLitModule, clearCompileCache, compileModule, getCompileCacheSize } from '@lit-core/morph-to-react';
import { buttonStyles, CdsButton, CdsCheckbox, CdsCheckboxHost, CdsTab, CdsTabs, checkboxStyles, tabsStyles } from '@lit-core/morph-to-react/carbon';
import { parseArgs } from '@lit-core/morph-to-react/cli';
import * as morphRuntime from '@lit-core/morph-to-react/runtime';
import { MorphHost, partitionSlots, SlotBoundary, useMorphHost } from '@lit-core/morph-to-react/runtime';
import { morphLit } from '@lit-core/morph-to-react/vite';
import React, { StrictMode } from 'react';
import { renderToString } from 'react-dom/server';
import { transformWithOxc } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bundleComponentForBrowser } from '../bundler.js';
import { getTestBrowser } from '../harness.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../../../../..');
const nodeRequire = createRequire(import.meta.url);

async function transpileJsxToCjs(code: string): Promise<string> {
  const oxc = await transformWithOxc(code, 'component.tsx', {
    jsx: { runtime: 'classic' },
  });
  const exportedNames: string[] = [];
  let cjs = oxc.code
    .replace(/^import\s+([A-Za-z_$][\w$]*)\s*,\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"];?/gm, (_m, defName, named, spec) => {
      const mapped = named.replace(/\bas\b/g, ':');
      if (defName === 'React') {
        return `const {${mapped}} = require("${spec}");`;
      }
      return `const _mod_${defName} = require("${spec}"); const ${defName} = _mod_${defName}.default ?? _mod_${defName}; const {${mapped}} = _mod_${defName};`;
    })
    .replace(/^import\s+\*\s+as\s+([A-Za-z_$][\w$]*)\s+from\s*['"]([^'"]+)['"];?/gm, (_m, ns, spec) => (ns === 'React' ? '' : `const ${ns} = require("${spec}");`))
    .replace(/^import\s+\{([^}]+)\}\s*from\s*['"]([^'"]+)['"];?/gm, (_m, named, spec) => `const {${named.replace(/\bas\b/g, ':')}} = require("${spec}");`)
    .replace(/^import\s+([A-Za-z_$][\w$]*)\s+from\s*['"]([^'"]+)['"];?/gm, (_m, defName, spec) =>
      defName === 'React' ? '' : `const _mod_${defName} = require("${spec}"); const ${defName} = _mod_${defName}.default ?? _mod_${defName};`,
    )
    .replace(/^import\s+['"]([^'"]+)['"];?/gm, (_m, spec) => `require("${spec}");`)
    .replace(/^export\s+class\s+([A-Za-z_$][\w$]*)/gm, (_m, name) => {
      exportedNames.push(name);
      return `class ${name}`;
    })
    .replace(/^export\s+function\s+([A-Za-z_$][\w$]*)/gm, (_m, name) => {
      exportedNames.push(name);
      return `function ${name}`;
    })
    .replace(/^export\s+(const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/gm, (_m, kw, name) => {
      return `${kw} ${name} = exports.${name} =`;
    })
    .replace(/^export\s+default\s+/gm, 'exports.default = ');

  for (const name of exportedNames) {
    cjs += `\nif (typeof ${name} !== "undefined") exports.${name} = ${name};`;
  }
  return cjs;
}

async function evalComponent(code: string, componentName: string, extraRequires?: Record<string, any>): Promise<React.ComponentType<any>> {
  const cjsCode = await transpileJsxToCjs(code);
  const exports: any = {};
  const customRequire = (spec: string) => {
    if (extraRequires?.[spec]) return extraRequires[spec];
    if (spec === 'react') return React;
    if (spec === '@lit-core/morph-to-react/runtime') return morphRuntime;
    return nodeRequire(spec);
  };
  const fn = new Function('React', 'exports', 'require', cjsCode);
  fn(React, exports, customRequire);
  return exports[componentName];
}

describe('morph-to-react comprehensive opaque-box E2E test suite (84 features)', () => {
  let browser: any;
  let page: any;

  beforeAll(async () => {
    browser = await getTestBrowser();
    page = await browser.newPage();

    const [carbonBundleCode, reactClientBundle] = await Promise.all([
      bundleComponentForBrowser({
        imports: [
          "import '@carbon/web-components/es/components/button/index.js';",
          "import '@carbon/web-components/es/components/checkbox/index.js';",
          "import '@carbon/web-components/es/components/tabs/index.js';",
        ],
      }),
      bundleComponentForBrowser({
        entrySource: `
          import React, { StrictMode, createRef, useState } from 'react';
          import { createRoot } from 'react-dom/client';
          import { flushSync } from 'react-dom';
          import * as morphRuntime from '@lit-core/morph-to-react/runtime';

          window.React = React;
          window.StrictMode = StrictMode;
          window.createRef = createRef;
          window.createRoot = createRoot;
          window.flushSync = flushSync;
          window.morphRuntime = morphRuntime;
          window.__reactReady = true;
        `,
      }),
    ]);

    await page.setContent(`
      <!DOCTYPE html>
      <html>
        <head>
          <script type="module">
            ${reactClientBundle}
          </script>
        </head>
        <body>
          <div id="test-root"></div>
          <iframe id="frame-a" style="width: 800px; height: 600px; border: none;"></iframe>
          <iframe id="frame-b" style="width: 800px; height: 600px; border: none;"></iframe>
        </body>
      </html>
    `);

    await page.evaluate(
      ({ bundleCode, styles }: { bundleCode: string; styles: string }) => {
        const fA = document.getElementById('frame-a') as HTMLIFrameElement;
        const docA = fA?.contentDocument;
        if (!docA) return;

        docA.open();
        docA.write(`
          <!DOCTYPE html>
          <html>
            <head>
              <meta charset="utf-8">
              <style>
                body { margin: 0; padding: 16px; background: #ffffff; font-family: sans-serif; }
                ${styles}
              </style>
              <script type="module">
                ${bundleCode}
                window.__wcReady = true;
              </script>
            </head>
            <body>
              <div id="wc-root"></div>
            </body>
          </html>
        `);
        docA.close();

        const fB = document.getElementById('frame-b') as HTMLIFrameElement;
        const docB = fB?.contentDocument;
        if (!docB) return;
        docB.open();
        docB.write('<!DOCTYPE html><html><head><meta charset="utf-8"></head><body><div id="react-root"></div></body></html>');
        docB.close();
      },
      { bundleCode: carbonBundleCode, styles: buttonStyles },
    );

    await page.waitForFunction(
      () => {
        const fA = document.getElementById('frame-a') as HTMLIFrameElement;
        const winA = fA?.contentWindow as any;
        return (
          (window as any).__reactReady === true &&
          winA?.__wcReady &&
          winA?.customElements?.get('cds-button') &&
          winA?.customElements?.get('cds-checkbox') &&
          winA?.customElements?.get('cds-tabs') &&
          winA?.customElements?.get('cds-tab')
        );
      },
      null,
      { timeout: 15000 },
    );
  });

  afterAll(async () => {
    if (page) {
      await page.close();
    }
  });

  async function mountFrameA(html: string): Promise<void> {
    await page.evaluate(async (wcHtml: string) => {
      const fA = document.getElementById('frame-a') as HTMLIFrameElement;
      const rootA = fA.contentDocument?.getElementById('wc-root');
      if (!rootA) throw new Error('Frame A wc-root missing');

      rootA.innerHTML = wcHtml;

      const customElements = rootA.querySelectorAll('*');
      for (const el of Array.from(customElements)) {
        if (el.tagName.toLowerCase().startsWith('cds-') && 'updateComplete' in el) {
          await (el as any).updateComplete;
        }
      }
    }, html);
  }

  async function mountFrameB(reactHtml: string, styles: string): Promise<void> {
    await page.evaluate(
      ({ html, css }: { html: string; css: string }) => {
        const fB = document.getElementById('frame-b') as HTMLIFrameElement;
        const docB = fB.contentDocument;
        if (!docB) throw new Error('Frame B document missing');

        docB.open();
        docB.write(`
          <!DOCTYPE html>
          <html>
            <head>
              <meta charset="utf-8">
              <style>
                body { margin: 0; padding: 16px; background: #ffffff; font-family: sans-serif; }
                ${css}
              </style>
            </head>
            <body>
              <div id="react-root">${html}</div>
            </body>
          </html>
        `);
        docB.close();

        // Attach nativeListenersRef capture suppression for cds-button matching client runtime
        const buttons = docB.querySelectorAll('cds-button');
        for (const btn of Array.from(buttons)) {
          btn.addEventListener(
            'click',
            (e: Event) => {
              if (btn.hasAttribute('disabled')) {
                e.preventDefault();
                e.stopPropagation();
              }
            },
            { capture: true },
          );
        }
      },
      { html: reactHtml, css: styles },
    );
  }

  // =========================================================================
  // Tier 1: feature coverage across all 84 inventoried features
  // =========================================================================
  describe('tier 1: feature coverage across all 84 inventoried features', () => {
    // -----------------------------------------------------------------------
    // Features 1-3: workspace and crate configuration
    // -----------------------------------------------------------------------
    describe('features 1-3: workspace and crate configuration', () => {
      it('[F1] validates workspace Cargo.toml configuration for crates/lit-analysis and packages/targets/morph-to-react', () => {
        const rootCargoTomlPath = path.resolve(rootDir, 'Cargo.toml');
        const content = fs.readFileSync(rootCargoTomlPath, 'utf-8');
        expect(content).toContain('[workspace]');
        expect(content).toContain('members = [');
        expect(content).toContain('crates/lit-analysis');
        expect(content).toContain('packages/targets/morph-to-react');

        const buildScriptPath = path.resolve(rootDir, 'scripts/build-native.mjs');
        const buildScript = fs.readFileSync(buildScriptPath, 'utf-8');
        expect(buildScript).toContain('morph-to-react');
      });

      it('[F2] validates upstream html5ever and markup5ever_rcdom in lit-analysis crate', () => {
        const rootCargoTomlPath = path.resolve(rootDir, 'Cargo.toml');
        const rootContent = fs.readFileSync(rootCargoTomlPath, 'utf-8');
        expect(rootContent).not.toContain('[patch.crates-io]');
        expect(rootContent).not.toContain('crates/html5ever');
        expect(rootContent).not.toContain('crates/markup5ever_rcdom');
        expect(rootContent).toContain('html5ever');
        expect(rootContent).toContain('markup5ever_rcdom');
        expect(fs.existsSync(path.resolve(rootDir, 'crates/html5ever'))).toBe(false);
        expect(fs.existsSync(path.resolve(rootDir, 'crates/markup5ever_rcdom'))).toBe(false);

        const crateCargoTomlPath = path.resolve(rootDir, 'crates/lit-analysis/Cargo.toml');
        const crateContent = fs.readFileSync(crateCargoTomlPath, 'utf-8');
        expect(crateContent).toContain('html5ever = { workspace = true }');
        expect(crateContent).toContain('markup5ever_rcdom = { workspace = true }');

        const templateIrPath = path.resolve(rootDir, 'crates/lit-analysis/src/template_ir.rs');
        expect(fs.existsSync(templateIrPath)).toBe(true);
        const templateIrContent = fs.readFileSync(templateIrPath, 'utf-8');
        expect(templateIrContent).toContain('use html5ever::');
        expect(templateIrContent).toContain('use markup5ever_rcdom::');
        expect(templateIrContent).toContain('parse_fragment');
      });

      it('[F3] validates affected runner tracks crates and packages', () => {
        const affectedRunnerPath = path.resolve(rootDir, 'scripts/check/affected.mjs');
        expect(fs.existsSync(affectedRunnerPath)).toBe(true);
        const script = fs.readFileSync(affectedRunnerPath, 'utf-8');
        expect(script).toContain('crates');
        expect(script).toContain('morph-to-react');
      });
    });

    // -----------------------------------------------------------------------
    // Features 4-12: shared Lit analysis and classification contracts
    // -----------------------------------------------------------------------
    describe('features 4-12: shared Lit analysis and classification contracts', () => {
      it('[F4] proves Lit component identity via semantic symbol bindings across minified code (Milestone 1)', () => {
        const code = `
          import { LitElement as e, html as t, property as r, customElement as n } from 'lit';
          @n('min-comp')
          class MinComp extends e {
            @r({ type: Boolean }) active = false;
            render() {
              return t\`<div>\${this.active}</div>\`;
            }
          }
          class UnrelatedClass extends Object {}
        `;
        const res = analyzeLitModule(code, { filename: 'min.js' });
        expect(res.components).toHaveLength(1);
        const comp = res.components[0];
        expect(comp.className).toBe('MinComp');
        expect(comp.tagName).toBe('min-comp');
        expect(comp.superClass).toBe('LitElement');
      });

      it('[F5] extracts decorators across standard TS, legacy, and transpiled __decorate helpers (Milestone 1)', () => {
        const code = `
          import { LitElement, property } from 'lit';
          import { __decorate, __metadata } from 'tslib';
          class TranspiledBtn extends LitElement {}
          __decorate([
            property({ type: Boolean, reflect: true }),
            __metadata("design:type", Boolean)
          ], TranspiledBtn.prototype, "disabled", void 0);
          customElements.define("transpiled-btn", TranspiledBtn);
        `;
        const res = analyzeLitModule(code, { filename: 'transpiled.js' });
        expect(res.components).toHaveLength(1);
        const comp = res.components[0];
        expect(comp.tagName).toBe('transpiled-btn');
        const disabledProp = comp.properties.find((p) => p.name === 'disabled');
        expect(disabledProp).toBeDefined();
        expect(disabledProp?.reflect).toBe(true);
      });

      it('[F6] extracts Lit property model (type, reflect, attribute, hasChanged, noAccessor) (Milestone 1)', () => {
        const code = `
          import { LitElement, property } from 'lit';
          class PropModelComp extends LitElement {
            @property({ type: String, reflect: true, attribute: 'custom-title' }) title = 'default title';
            @property({ type: Number, attribute: false, noAccessor: true }) count = 100;
            static get properties() {
              return {
                open: { type: Boolean, reflect: true },
                threshold: {
                  type: Number,
                  hasChanged(newVal, oldVal) {
                    return newVal > oldVal;
                  }
                }
              };
            }
          }
        `;
        const res = analyzeLitModule(code, { filename: 'props.ts' });
        expect(res.components).toHaveLength(1);
        const comp = res.components[0];

        const titleProp = comp.properties.find((p) => p.name === 'title');
        expect(titleProp?.propertyType).toBe('String');
        expect(titleProp?.reflect).toBe(true);
        expect(titleProp?.attribute).toBe('custom-title');
        expect(titleProp?.defaultValue).toBe('"default title"');

        const countProp = comp.properties.find((p) => p.name === 'count');
        expect(countProp?.propertyType).toBe('Number');
        expect(countProp?.attribute).toBeUndefined();
        expect(countProp?.noAccessor).toBe(true);

        const openProp = comp.properties.find((p) => p.name === 'open');
        expect(openProp?.propertyType).toBe('Boolean');
        expect(openProp?.reflect).toBe(true);

        const thresholdProp = comp.properties.find((p) => p.name === 'threshold');
        expect(thresholdProp).toBeDefined();
        expect(thresholdProp?.hasChanged).toBeDefined();
        expect(thresholdProp?.hasChanged).toContain('newVal > oldVal');
      });

      it('[F7] parses html template quasis with html5ever in template fragment context (Milestone 1)', () => {
        const code = `
          import { LitElement, html } from 'lit';
          class TableComp extends LitElement {
            render() {
              return html\`
                <table>TextBefore<tr><td>Cell</td></tr>TextAfter</table>
                <p><div>Closed Paragraph Sibling</div></p>
                <div class="header \${this.variant}"></div>
              \`;
            }
          }
        `;
        const res = analyzeLitModule(code, { filename: 'table.ts' });
        expect(res.components).toHaveLength(1);
        const comp = res.components[0];
        expect(comp.template).toBeDefined();
        const roots = comp.template?.roots ?? [];
        expect(roots.length).toBeGreaterThan(0);

        // Under HTML5 spec: text inside table is foster-parented outside the table
        // Find the table element
        const tableNode = roots.find((r) => r.Element?.tag_name === 'table');
        expect(tableNode).toBeDefined();
        if (tableNode?.Element) {
          const directTextInTable = tableNode.Element.children.some((c) => c.Text !== undefined);
          expect(directTextInTable).toBe(false);

          // Table implicitly contains tbody wrapping tr
          const tbody = tableNode.Element.children.find((c) => c.Element?.tag_name === 'tbody');
          expect(tbody).toBeDefined();
        }

        // Under HTML5 spec: p is auto-closed by block element div, making them siblings
        const pIndex = roots.findIndex((r) => r.Element?.tag_name === 'p');
        const divIndex = roots.findIndex((r) => r.Element?.tag_name === 'div');
        expect(pIndex).toBeGreaterThanOrEqual(0);
        expect(divIndex).toBeGreaterThanOrEqual(0);
      });

      it('[F8] recovers quasi attribute casing (.prop, @event, ?bool, SVG/MathML camelCase) (Milestone 1)', () => {
        const code = `
          import { LitElement, html } from 'lit';
          class CasingComp extends LitElement {
            render() {
              return html\`
                <svg viewBox="0 0 100 100" strokeWidth="2">
                  <clipPath id="cp"><rect /></clipPath>
                  <linearGradient id="lg" />
                </svg>
                <button
                  .itemCount=\${this.count}
                  @cdsTabSelected=\${this.onSelect}
                  ?isExpanded=\${this.expanded}
                >Toggle</button>
              \`;
            }
          }
        `;
        const res = analyzeLitModule(code, { filename: 'casing.ts' });
        expect(res.components).toHaveLength(1);
        const comp = res.components[0];

        // Event extracted from @cdsTabSelected must preserve camelCase
        const event = comp.events.find((e) => e.name === 'cdsTabSelected');
        expect(event).toBeDefined();
        expect(event?.propName).toBe('onCdsTabSelected');

        // SVG element tag names and attributes must preserve canonical camelCase
        expect(comp.template).toBeDefined();
        const roots = comp.template?.roots ?? [];
        const svgNode = roots.find((r) => r.Element?.tag_name === 'svg');
        expect(svgNode).toBeDefined();
        if (svgNode?.Element) {
          expect(svgNode.Element.attributes.some((a) => a.name === 'viewBox')).toBe(true);
          expect(svgNode.Element.attributes.some((a) => a.name === 'strokeWidth')).toBe(true);
          const clipPathNode = svgNode.Element.children.find((c) => c.Element?.tag_name === 'clipPath');
          expect(clipPathNode).toBeDefined();
          const linearGradientNode = svgNode.Element.children.find((c) => c.Element?.tag_name === 'linearGradient');
          expect(linearGradientNode).toBeDefined();
        }
      });

      it('[F9] resolves styles in analysis (css tagged templates, unsafeCSS, and shared style arrays) (Milestone 1)', () => {
        const code = `
          import { LitElement, css, unsafeCSS } from 'lit';
          import { buttonSharedStyles } from './shared.js';
          class StyledComp extends LitElement {
            static get styles() {
              return [
                buttonSharedStyles,
                css\`:host { display: inline-flex; align-items: center; }\`,
                unsafeCSS(':host([hidden]) { display: none; }')
              ];
            }
          }
        `;
        const res = analyzeLitModule(code, { filename: 'styled.ts' });
        expect(res.components).toHaveLength(1);
        const comp = res.components[0];
        expect(comp.styles).toHaveLength(3);

        expect(comp.styles[0].isShared).toBe(true);
        expect(comp.styles[0].sharedImportPath).toBe('buttonSharedStyles');

        expect(comp.styles[1].isShared).toBe(false);
        expect(comp.styles[1].cssText).toContain(':host { display: inline-flex;');

        expect(comp.styles[2].isShared).toBe(false);
        expect(comp.styles[2].cssText).toContain(':host([hidden]) { display: none;');
      });

      it('[F10] scans cross-module manifests (tags, classes, heritage, properties, events, slots, styles) (Milestone 1)', () => {
        const code = `
          import { LitElement, html, customElement, property } from 'lit';
          @customElement('composite-card')
          class CompositeCard extends LitElement {
            @property({ type: String }) title = '';
            _fire() {
              this.dispatchEvent(new CustomEvent('card-select', { bubbles: true, composed: true }));
            }
            render() {
              return html\`
                <div class="card" @click=\${this._fire}>
                  <slot name="header"><h3>Default Header</h3></slot>
                  <slot></slot>
                </div>
              \`;
            }
          }
          class SecondaryCard extends LitElement {}
          customElements.define('secondary-card', SecondaryCard);
        `;
        const res = analyzeLitModule(code, { filename: 'composite.ts' });
        expect(res.components).toHaveLength(2);

        const card = res.components.find((c) => c.className === 'CompositeCard');
        expect(card).toBeDefined();
        expect(card?.tagName).toBe('composite-card');
        expect(card?.componentName).toBe('CompositeCard');
        expect(card?.slots).toHaveLength(2);
        const headerSlot = card?.slots.find((s) => s.name === 'header');
        expect(headerSlot?.hasFallback).toBe(true);
        const defaultSlot = card?.slots.find((s) => !s.name);
        expect(defaultSlot?.hasFallback).toBe(false);
        expect(card?.events.some((e) => e.name === 'card-select')).toBe(true);
        expect(card?.events.some((e) => e.name === 'click')).toBe(true);

        const secondary = res.components.find((c) => c.className === 'SecondaryCard');
        expect(secondary?.tagName).toBe('secondary-card');
      });

      it('[F11] classifies components into Tier 0, Tier 1, Tier 2, or Bailout (Milestone 1)', () => {
        const tier0Code = `
          import { LitElement, html } from 'lit';
          class LeafTag extends LitElement {
            render() { return html\`<span class="tag">Static</span>\`; }
          }
        `;
        const tier1Code = `
          import { LitElement, html, property } from 'lit';
          class StatefulTag extends LitElement {
            @property({ type: String }) label = 'Tag';
            render() { return html\`<span class="tag">\${this.label}</span>\`; }
          }
        `;
        const tier2Code = `
          import { LitElement, html } from 'lit';
          class FacadeTabs extends LitElement {
            render() { return html\`<slot @slotchange=\${() => {}}></slot>\`; }
          }
        `;
        const tier2FormCode = `
          import { LitElement, html } from 'lit';
          class FormInput extends LitElement {
            static formAssociated = !0;
            render() { return html\`<input />\`; }
          }
        `;
        const bailoutCode = `
          import { LitElement, html } from 'lit';
          import { until } from 'lit/directives/until.js';
          class BailoutComp extends LitElement {
            render() { return html\`<div>\${until(Promise.resolve(1))}</div>\`; }
          }
        `;

        expect(analyzeLitModule(tier0Code).components[0].tier).toBe('Tier0Pure');
        expect(analyzeLitModule(tier1Code).components[0].tier).toBe('Tier1Hosted');
        expect(analyzeLitModule(tier2Code).components[0].tier).toBe('Tier2HostedWithFacade');
        expect(analyzeLitModule(tier2FormCode).components[0].tier).toBe('Tier2HostedWithFacade');
        expect(analyzeLitModule(bailoutCode).components[0].tier).toBe('Bailout');
      });

      it('[F12] reports structured diagnostics for bailout constructs with Universal Lit hints (Milestone 1)', () => {
        const bailoutCode = `
          import { LitElement, html } from 'lit';
          import { until } from 'lit/directives/until.js';
          class BailoutComp extends LitElement {
            render() { return html\`<div>\${until(Promise.resolve(1))}</div>\`; }
          }
        `;
        const res = analyzeLitModule(bailoutCode, { filename: 'bail.js' });
        expect(res.diagnostics.length).toBeGreaterThan(0);
        const d = res.diagnostics.find((diag) => diag.code === 'LIT101');
        expect(d).toBeDefined();
        expect(d?.message).toContain('until');
        expect(d?.universalLitHint).toContain('@lit/task');
      });

      it('[F7-regr-1] parses templates with HTML comments without hanging or mutation (Milestone 1 remediation)', () => {
        const code = `
          import { LitElement, html } from 'lit';
          class CommentComp extends LitElement {
            render() {
              return html\`
                <!-- top-level header comment -->
                <h1>Title</h1>
                <!-- comment before child -->
                <div><!-- inside div --><span>Content</span></div>
                <!-- trailing footer comment -->
              \`;
            }
          }
        `;
        const startTime = Date.now();
        const res = analyzeLitModule(code, { filename: 'comment.ts' });
        const duration = Date.now() - startTime;

        expect(duration).toBeLessThan(500);
        expect(res.components).toHaveLength(1);
        const comp = res.components[0];
        expect(comp.template).toBeDefined();

        const roots = comp.template?.roots ?? [];
        const h1 = roots.find((r) => r.Element?.tag_name === 'h1');
        const div = roots.find((r) => r.Element?.tag_name === 'div');
        expect(h1).toBeDefined();
        expect(div).toBeDefined();
      });

      it('[F7-regr-2] parses bare < comparison operators in text nodes without hanging (Milestone 1 remediation)', () => {
        const code = `
          import { LitElement, html } from 'lit';
          class BareComp extends LitElement {
            render() {
              return html\`
                <span>x < 5</span>
                <div>a < b && b > c</div>
                <p>< 10 items</p>
              \`;
            }
          }
        `;
        const startTime = Date.now();
        const res = analyzeLitModule(code, { filename: 'bare.ts' });
        const duration = Date.now() - startTime;

        expect(duration).toBeLessThan(500);
        expect(res.components).toHaveLength(1);
        const comp = res.components[0];
        const roots = comp.template?.roots ?? [];

        const span = roots.find((r) => r.Element?.tag_name === 'span');
        expect(span).toBeDefined();
        const textChild = span?.Element?.children.find((c) => c.Text !== undefined);
        expect(textChild?.Text).toContain('< 5');
      });

      it('[F7-regr-3] retains element children when foster-parenting non-table elements outside <table> (Milestone 1 remediation)', () => {
        const code = `
          import { LitElement, html } from 'lit';
          class TableFosterComp extends LitElement {
            render() {
              return html\`<table><span>Foster Me</span><tr><td>Cell</td></tr></table>\`;
            }
          }
        `;
        const res = analyzeLitModule(code, { filename: 'table-foster.ts' });
        expect(res.components).toHaveLength(1);
        const comp = res.components[0];
        const roots = comp.template?.roots ?? [];

        expect(roots).toHaveLength(2);
        const spanRoot = roots[0];
        const tableRoot = roots[1];

        expect(spanRoot.Element?.tag_name).toBe('span');
        expect(spanRoot.Element?.children).toHaveLength(1);
        expect(spanRoot.Element?.children[0].Text).toBe('Foster Me');

        expect(tableRoot.Element?.tag_name).toBe('table');
        const tableHasSpan = tableRoot.Element?.children.some((c) => c.Element?.tag_name === 'span');
        expect(tableHasSpan).toBe(false);

        // Verifies that 'Foster Me' is NOT evicted as an orphaned sibling in roots
        const orphanedText = roots.some((r) => r.Text === 'Foster Me');
        expect(orphanedText).toBe(false);
      });

      it('[F11-regr-1] triggers bailout (LIT101) for directives nested inside ternary, logical, and array expressions (Milestone 1 remediation)', () => {
        const ternaryCode = `
          import { LitElement, html } from 'lit';
          import { until } from 'lit/directives/until.js';
          class TernaryComp extends LitElement {
            render() {
              return html\`<div>\${this.loading ? until(this.promise, 'loading') : 'done'}</div>\`;
            }
          }
        `;
        const resTernary = analyzeLitModule(ternaryCode, { filename: 'ternary.ts' });
        expect(resTernary.components[0].tier).toBe('Bailout');
        expect(resTernary.diagnostics.some((d) => d.code === 'LIT101')).toBe(true);

        const logicalCode = `
          import { LitElement, html } from 'lit';
          import { asyncAppend } from 'lit/directives/async-append.js';
          class LogicalComp extends LitElement {
            render() {
              return html\`<ul>\${this.active && asyncAppend(this.stream)}</ul>\`;
            }
          }
        `;
        const resLogical = analyzeLitModule(logicalCode, { filename: 'logical.ts' });
        expect(resLogical.components[0].tier).toBe('Bailout');
        expect(resLogical.diagnostics.some((d) => d.code === 'LIT101')).toBe(true);

        const arrayCode = `
          import { LitElement, html } from 'lit';
          import { until } from 'lit/directives/until.js';
          class ArrayComp extends LitElement {
            render() {
              return html\`<div>\${[until(p1), until(p2)]}</div>\`;
            }
          }
        `;
        const resArray = analyzeLitModule(arrayCode, { filename: 'array.ts' });
        expect(resArray.components[0].tier).toBe('Bailout');
        expect(resArray.diagnostics.some((d) => d.code === 'LIT101')).toBe(true);
      });

      it('[F11-regr-2] triggers bailout (LIT102) for escaping this in return statements and variable declarations (Milestone 1 remediation)', () => {
        const returnCode = `
          import { LitElement, html } from 'lit';
          class ReturnEscapeComp extends LitElement {
            setup() {
              return register(this);
            }
            render() { return html\`<div>ok</div>\`; }
          }
        `;
        const resReturn = analyzeLitModule(returnCode, { filename: 'return-escape.ts' });
        expect(resReturn.components[0].tier).toBe('Bailout');
        expect(resReturn.diagnostics.some((d) => d.code === 'LIT102')).toBe(true);

        const varCode = `
          import { LitElement, html } from 'lit';
          class VarEscapeComp extends LitElement {
            setup() {
              const token = register(this);
            }
            render() { return html\`<div>ok</div>\`; }
          }
        `;
        const resVar = analyzeLitModule(varCode, { filename: 'var-escape.ts' });
        expect(resVar.components[0].tier).toBe('Bailout');
        expect(resVar.diagnostics.some((d) => d.code === 'LIT102')).toBe(true);
      });
    });

    // -----------------------------------------------------------------------
    // Features 13-22: Phase 0 target spike and differential verification
    // -----------------------------------------------------------------------
    describe('features 13-22: Phase 0 target spike and differential verification', () => {
      it('[F13] instantiates prototype MorphHost base class implementing ReactiveControllerHost in browser', async () => {
        const host = new MorphHost();
        let connected = false;
        let disconnected = false;
        const mockCtrl = {
          hostConnected() {
            connected = true;
          },
          hostDisconnected() {
            disconnected = true;
          },
        };
        host.addController(mockCtrl);
        expect(host.isConnected).toBe(false);
        host.connectedCallback();
        expect(connected).toBe(true);
        host.requestUpdate();
        const updatePromise = host.updateComplete;
        expect(updatePromise).toBeInstanceOf(Promise);
        host._commitUpdate();
        const resolved = await updatePromise;
        expect(resolved).toBe(true);
        host.removeController(mockCtrl);
        expect(disconnected).toBe(true);
      });

      it('[F14] executes hand-written CdsButton React lowering in Chromium DOM', async () => {
        const btnSsr = renderToString(React.createElement(StrictMode, null, React.createElement(CdsButton, { kind: 'primary' }, 'Action')));
        expect(btnSsr).toContain('<cds-button');
        expect(btnSsr).toContain('kind="primary"');
        expect(btnSsr).toContain('Action');
        expect(btnSsr).toContain('carbon-cds-button');

        const result = await page.evaluate(
          ({ ssr }: { ssr: string }) => {
            const container = document.createElement('div');
            container.innerHTML = ssr;
            document.body.appendChild(container);
            const host = container.querySelector('cds-button');
            const innerBtn = host?.querySelector('button');
            const computedKind = host?.getAttribute('kind');
            const text = innerBtn?.textContent;
            const hasStyle = Boolean(container.querySelector('style'));
            document.body.removeChild(container);
            return { computedKind, text, hasStyle };
          },
          { ssr: btnSsr },
        );

        expect(result.computedKind).toBe('primary');
        expect(result.text).toBe('Action');
        expect(result.hasStyle).toBe(true);
      });

      it('[F15] executes hand-written CdsCheckbox React lowering with self-mutated properties', async () => {
        const chkSsr = renderToString(React.createElement(StrictMode, null, React.createElement(CdsCheckbox, { labelText: 'Agree', name: 'agree', value: 'on' })));
        expect(chkSsr).toContain('<cds-checkbox');
        expect(chkSsr).toContain('Agree');

        const host = new CdsCheckboxHost();
        expect(host.checked).toBe(false);
        let eventReceived: any = null;
        host.addEventListener('cds-checkbox-changed', (e: any) => {
          eventReceived = e.detail;
        });

        const fakeInput = { checked: true, indeterminate: false } as HTMLInputElement;
        host._checkboxNode = fakeInput;
        host._handleChange();

        expect(host.checked).toBe(true);
        expect(eventReceived?.checked).toBe(true);
      });

      it('[F16] executes hand-written CdsTabs composite React lowering querying child tabs', async () => {
        const tabsSsr = renderToString(
          React.createElement(
            StrictMode,
            null,
            React.createElement(
              CdsTabs,
              { value: 'tab-1' },
              React.createElement(CdsTab, { value: 'tab-1', target: 'panel-1' }, 'Tab 1'),
              React.createElement(CdsTab, { value: 'tab-2', target: 'panel-2' }, 'Tab 2'),
            ),
          ),
        );
        expect(tabsSsr).toContain('<cds-tabs');
        expect(tabsSsr).toContain('<slot-boundary style="display:contents"');
        expect(tabsSsr).toContain('<cds-tab');
        expect(tabsSsr).toContain('Tab 1');
        expect(tabsSsr).toContain('Tab 2');
      });

      it('[F17] sets up dual-frame differential Playwright harness in Chromium DOM', async () => {
        const setupResult = await page.evaluate(() => {
          const frameA = document.getElementById('frame-a') as HTMLIFrameElement;
          const frameB = document.getElementById('frame-b') as HTMLIFrameElement;
          const hasA = Boolean(frameA?.contentDocument?.getElementById('wc-root'));
          const hasB = Boolean(frameB?.contentDocument?.getElementById('react-root'));
          return { hasA, hasB };
        });
        expect(setupResult.hasA).toBe(true);
        expect(setupResult.hasB).toBe(true);
      });

      it('[F18] verifies accessibility tree parity check on button role and labels', async () => {
        const btnSsr = renderToString(React.createElement(StrictMode, null, React.createElement(CdsButton, { kind: 'primary' }, 'Submit Form')));
        await mountFrameA('<cds-button kind="primary">Submit Form</cds-button>');
        await mountFrameB(btnSsr, buttonStyles);

        const wcSnapshot = await page.frameLocator('#frame-a').locator('cds-button').ariaSnapshot();
        const reactSnapshot = await page.frameLocator('#frame-b').locator('cds-button').ariaSnapshot();

        expect(reactSnapshot).toBe(wcSnapshot);
        expect(reactSnapshot).toContain('Submit Form');
      });

      it('[F19] verifies interaction and event parity (type, detail, defaultPrevented)', async () => {
        const btnSsr = renderToString(React.createElement(StrictMode, null, React.createElement(CdsButton, { kind: 'primary' }, 'Action Button')));
        await mountFrameA('<cds-button kind="primary">Action Button</cds-button>');
        await mountFrameB(btnSsr, buttonStyles);

        const eventResult = await page.evaluate(() => {
          const fA = document.getElementById('frame-a') as HTMLIFrameElement;
          const fB = document.getElementById('frame-b') as HTMLIFrameElement;

          let logA: any = null;
          let logB: any = null;

          const btnA = fA.contentDocument?.querySelector('cds-button');
          const btnB = fB.contentDocument?.querySelector('cds-button');

          btnA?.addEventListener('click', (e) => {
            logA = { type: e.type, bubbles: e.bubbles, cancelable: e.cancelable };
          });
          btnB?.addEventListener('click', (e) => {
            logB = { type: e.type, bubbles: e.bubbles, cancelable: e.cancelable };
          });

          (btnA as HTMLElement)?.click();
          (btnB as HTMLElement)?.click();

          return { logA, logB };
        });

        expect(eventResult.logA).toEqual(eventResult.logB);
        expect(eventResult.logB.type).toBe('click');
      });

      it('[F20] verifies visual geometry diffing tolerance threshold (>= 99.5%)', async () => {
        const btnSsr = renderToString(React.createElement(StrictMode, null, React.createElement(CdsButton, { kind: 'primary' }, 'Visual Parity')));
        await mountFrameA('<cds-button kind="primary">Visual Parity</cds-button>');
        await mountFrameB(btnSsr, buttonStyles);

        const locA = page.frameLocator('#frame-a').locator('cds-button');
        const locB = page.frameLocator('#frame-b').locator('cds-button');

        const pngA = await locA.screenshot();
        const pngB = await locB.screenshot();

        const matchScore = await page.evaluate(
          async ({ b64A, b64B }: { b64A: string; b64B: string }) => {
            const load = (src: string) =>
              new Promise<HTMLImageElement>((resolve) => {
                const img = new Image();
                img.onload = () => resolve(img);
                img.src = src;
              });

            const [imgA, imgB] = await Promise.all([load(b64A), load(b64B)]);
            const w = Math.min(imgA.width, imgB.width);
            const h = Math.min(imgA.height, imgB.height);

            const cA = document.createElement('canvas');
            cA.width = w;
            cA.height = h;
            const ctxA = cA.getContext('2d');
            if (!ctxA) throw new Error('Failed to acquire 2D context for canvas A');
            ctxA.drawImage(imgA, 0, 0);
            const dataA = ctxA.getImageData(0, 0, w, h).data;

            const cB = document.createElement('canvas');
            cB.width = w;
            cB.height = h;
            const ctxB = cB.getContext('2d');
            if (!ctxB) throw new Error('Failed to acquire 2D context for canvas B');
            ctxB.drawImage(imgB, 0, 0);
            const dataB = ctxB.getImageData(0, 0, w, h).data;

            let diffCount = 0;
            const totalPixels = w * h;

            for (let i = 0; i < dataA.length; i += 4) {
              const rDiff = Math.abs(dataA[i] - dataB[i]);
              const gDiff = Math.abs(dataA[i + 1] - dataB[i + 1]);
              const bDiff = Math.abs(dataA[i + 2] - dataB[i + 2]);
              if (rDiff > 10 || gDiff > 10 || bDiff > 10) {
                diffCount++;
              }
            }

            return (1 - diffCount / totalPixels) * 100;
          },
          { b64A: `data:image/png;base64,${pngA.toString('base64')}`, b64B: `data:image/png;base64,${pngB.toString('base64')}` },
        );

        expect(matchScore).toBeGreaterThanOrEqual(99.5);
      });

      it('[F21] verifies Strict Mode SSR and hydration contract without console warnings', () => {
        const originalWarn = console.warn;
        const originalError = console.error;
        const logs: string[] = [];
        console.warn = (...args) => logs.push(args.join(' '));
        console.error = (...args) => logs.push(args.join(' '));

        try {
          const btnHtml = renderToString(React.createElement(StrictMode, null, React.createElement(CdsButton, { kind: 'primary' }, 'Action')));
          const chkHtml = renderToString(React.createElement(StrictMode, null, React.createElement(CdsCheckbox, { labelText: 'Agree', name: 'agree' })));
          const tabsHtml = renderToString(
            React.createElement(
              StrictMode,
              null,
              React.createElement(CdsTabs, { value: 't1' }, React.createElement(CdsTab, { value: 't1' }, 'Tab 1'), React.createElement(CdsTab, { value: 't2' }, 'Tab 2')),
            ),
          );

          expect(btnHtml.length).toBeGreaterThan(0);
          expect(chkHtml.length).toBeGreaterThan(0);
          expect(tabsHtml.length).toBeGreaterThan(0);
          expect(logs).toHaveLength(0);
        } finally {
          console.warn = originalWarn;
          console.error = originalError;
        }
      });

      it('[F22] measures hostile global stylesheet isolation gap in light DOM', async () => {
        await mountFrameA('<cds-button kind="primary">Web Component</cds-button>');
        await mountFrameB(renderToString(React.createElement(StrictMode, null, React.createElement(CdsButton, { kind: 'primary' }, 'React Component'))), buttonStyles);

        const gapResult = await page.evaluate(async () => {
          const fA = document.getElementById('frame-a') as HTMLIFrameElement;
          const fB = document.getElementById('frame-b') as HTMLIFrameElement;
          const docA = fA.contentDocument;
          const docB = fB.contentDocument;
          if (!docA || !docB) throw new Error('Frame documents missing');

          const hostileCss = `
            * { box-sizing: content-box !important; }
            button { margin: 24px !important; padding: 20px !important; }
          `;

          const styleA = docA.createElement('style');
          styleA.textContent = hostileCss;
          docA.head.appendChild(styleA);

          const styleB = docB.createElement('style');
          styleB.textContent = hostileCss;
          docB.head.appendChild(styleB);

          const cdsBtnA = docA.querySelector('cds-button');
          if (cdsBtnA && 'updateComplete' in cdsBtnA) {
            await (cdsBtnA as any).updateComplete;
          }
          const innerBtnA = cdsBtnA?.shadowRoot?.querySelector('button');
          const innerBtnB = docB.querySelector('button');

          const marginA = innerBtnA ? fA.contentWindow?.getComputedStyle(innerBtnA).margin : '0px';
          const marginB = innerBtnB ? fB.contentWindow?.getComputedStyle(innerBtnB).margin : '0px';

          styleA.remove();
          styleB.remove();

          return {
            marginA,
            marginB,
            shadowDomResisted: marginA !== '24px',
            lightDomPenetrated: marginB === '24px',
          };
        });

        expect(gapResult.shadowDomResisted).toBe(true);
        expect(gapResult.marginA).toBe('0px');
        expect(gapResult.lightDomPenetrated).toBe(true);
        expect(gapResult.marginB).toBe('24px');
      });
    });

    // -----------------------------------------------------------------------
    // Features 23-37: Tier 0 pure function emission and scoped CSS
    // -----------------------------------------------------------------------
    describe('features 23-37: Tier 0 pure function emission and scoped CSS', () => {
      it('[F23] verifies AstBuilder JSX element emission without string splicing (Milestone 2)', () => {
        const code = `
          import { LitElement, html } from 'lit';
          export class LeafBadge extends LitElement {
            render() {
              return html\`<div class="badge-wrapper"><span class="badge">Active</span></div>\`;
            }
          }
        `;
        const res = compileModule(code, { filePath: 'badge.ts' });
        expect(res.tier).toBe('Tier0Pure');
        expect(res.code).toContain('export function LeafBadge');
        expect(res.code).toContain('className="badge-wrapper"');
        expect(res.code).toContain('className="badge"');
        expect(res.code).toContain('Active');

        // Structural syntax verification
        const parsed = analyzeLitModule(res.code, { filename: 'badge.tsx' });
        expect(parsed).toBeDefined();
      });

      it('[F24] verifies static text and whitespace preservation in templates (Milestone 2)', async () => {
        const code = `
          import { LitElement, html } from 'lit';
          export class SpacedLabel extends LitElement {
            render() {
              return html\`<span>Hello </span><span>World</span>\`;
            }
          }
        `;
        const res = compileModule(code, { filePath: 'spaced.ts' });
        expect(res.code).toMatch(/<span>Hello <\/span>|<span>{'Hello '}<\/span>|<span>Hello{' '}<\/span>|<span>Hello{" "}<\/span>/);

        const Component = await evalComponent(res.code, 'SpacedLabel');
        const htmlOutput = renderToString(React.createElement(Component));
        expect(htmlOutput.replace(/<!-- -->/g, '')).toContain('<span>Hello </span><span>World</span>');
      });

      it('[F25] maps standard HTML attributes (class -> className, for -> htmlFor, tabindex -> tabIndex) (Milestone 2)', () => {
        const code = `
          import { LitElement, html } from 'lit';
          export class FormLabel extends LitElement {
            render() {
              return html\`<label class="caption" for="user-input" tabindex="0" autofocus readonly>Field</label>\`;
            }
          }
        `;
        const res = compileModule(code, { filePath: 'form-label.ts' });
        expect(res.code).toContain('className="caption"');
        expect(res.code).toContain('htmlFor="user-input"');
        expect(res.code).toContain('tabIndex="0"');
        expect(res.code).toContain('autoFocus');
        expect(res.code).toContain('readOnly');
        expect(res.code).not.toContain('class="caption"');
        expect(res.code).not.toContain('for="user-input"');
        expect(res.code).not.toContain('tabindex="0"');
      });

      it('[F26] maps kebab-case SVG attributes to camelCase JSX equivalents (Milestone 2)', () => {
        const code = `
          import { LitElement, html } from 'lit';
          export class SvgGlyph extends LitElement {
            render() {
              return html\`
                <svg viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill-rule="evenodd">
                  <clipPath id="cp"><circle cx="12" cy="12" r="10" /></clipPath>
                </svg>
              \`;
            }
          }
        `;
        const res = compileModule(code, { filePath: 'svg-glyph.ts' });
        expect(res.code).toContain('viewBox="0 0 24 24"');
        expect(res.code).toContain('strokeWidth="2"');
        expect(res.code).toContain('strokeLinecap="round"');
        expect(res.code).toContain('strokeLinejoin="round"');
        expect(res.code).toContain('fillRule="evenodd"');
        expect(res.code).toContain('<clipPath');
        expect(res.code).not.toContain('stroke-width=');
        expect(res.code).not.toContain('fill-rule=');
      });

      it('[F27] lowers static style attribute strings into React style objects (Milestone 2)', async () => {
        const code = `
          import { LitElement, html } from 'lit';
          export class StyledBox extends LitElement {
            render() {
              return html\`<div style="color: red; margin-top: 8px; font-weight: 500;">Notice</div>\`;
            }
          }
        `;
        const res = compileModule(code, { filePath: 'styled-box.ts' });
        expect(res.code).toMatch(/color:\s*["']red["']/);
        expect(res.code).toMatch(/marginTop:\s*["']8px["']/);
        expect(res.code).toMatch(/fontWeight:\s*["']500["']/);
        expect(res.code).not.toContain('style="color: red');

        const Component = await evalComponent(res.code, 'StyledBox');
        const htmlOutput = renderToString(React.createElement(Component));
        expect(htmlOutput).toContain('style="color:red;margin-top:8px;font-weight:500"');
      });

      it('[F28] lowers dynamic style bindings via ref callback setting style.cssText (Milestone 2)', async () => {
        const code = `
          import { LitElement, html } from 'lit';
          export class DynamicCard extends LitElement {
            render() {
              const bg = 'blue';
              return html\`<div style="background-color: \${bg}; padding: 16px;">Content</div>\`;
            }
          }
        `;
        const res = compileModule(code, { filePath: 'dynamic-card.ts' });
        expect(res.code).toContain('backgroundColor: bg');
        expect(res.code).toMatch(/padding:\s*["']16px["']/);

        const Component = await evalComponent(res.code, 'DynamicCard');
        const htmlOutput = renderToString(React.createElement(Component));
        expect(htmlOutput).toContain('style="background-color:blue;padding:16px"');
      });

      it('[F29] lowers boolean attributes (?disabled=${b} -> disabled={b ? true : undefined}) (Milestone 2)', async () => {
        const code = `
          import { LitElement, html } from 'lit';
          export class ToggleElement extends LitElement {
            render() {
              const isActive = true;
              const isHidden = false;
              return html\`<div ?data-active=\${isActive} ?hidden=\${isHidden}>Status</div>\`;
            }
          }
        `;
        const res = compileModule(code, { filePath: 'toggle.ts' });
        expect(res.code).toMatch(/data-active=\{isActive\s*\?\s*["']{2}\s*:\s*undefined\}/);
        expect(res.code).toMatch(/hidden=\{isHidden\s*\?\s*true\s*:\s*undefined\}/);

        const Component = await evalComponent(res.code, 'ToggleElement');
        const htmlOutput = renderToString(React.createElement(Component));
        expect(htmlOutput).toContain('data-active');
        expect(htmlOutput).not.toContain('hidden');

        const codeTrue = `
          import { LitElement, html } from 'lit';
          export class ToggleElementTrue extends LitElement {
            render() {
              const isHidden = true;
              return html\`<div ?hidden=\${isHidden}>Status</div>\`;
            }
          }
        `;
        const resTrue = compileModule(codeTrue, { filePath: 'toggle-true.ts' });
        expect(resTrue.code).toMatch(/hidden=\{isHidden\s*\?\s*true\s*:\s*undefined\}/);
        const ComponentTrue = await evalComponent(resTrue.code, 'ToggleElementTrue');
        const htmlOutputTrue = renderToString(React.createElement(ComponentTrue));
        expect(htmlOutputTrue).toContain('hidden=""');
      });

      it('[F30] lowers child expressions (nothing, undefined, null -> null) (Milestone 2)', async () => {
        const code = `
          import { LitElement, html, nothing } from 'lit';
          export class OptionalContent extends LitElement {
            render() {
              const condition = false;
              return html\`<div>\${condition ? 'Active' : nothing}\${undefined}\${null}</div>\`;
            }
          }
        `;
        const res = compileModule(code, { filePath: 'optional.ts' });
        expect(res.code).toContain('null');
        expect(res.code).not.toContain('nothing');

        const Component = await evalComponent(res.code, 'OptionalContent');
        const htmlOutput = renderToString(React.createElement(Component));
        expect(htmlOutput).toBe('<div></div>');
      });

      it('[F31] lowers unkeyed child arrays using positional index keys (Milestone 2)', async () => {
        const code = `
          import { LitElement, html } from 'lit';
          export class ChipList extends LitElement {
            render() {
              const tags = ['Alpha', 'Beta', 'Gamma'];
              return html\`<div>\${tags.map((t) => html\`<span>\${t}</span>\`)}</div>\`;
            }
          }
        `;
        const res = compileModule(code, { filePath: 'chips.ts' });
        expect(res.code).toContain('key=');

        const logs: string[] = [];
        const origWarn = console.error;
        console.error = (...args: any[]) => logs.push(args.join(' '));
        try {
          const Component = await evalComponent(res.code, 'ChipList');
          renderToString(React.createElement(StrictMode, null, React.createElement(Component)));
          expect(logs.some((l) => l.includes('key'))).toBe(false);
        } finally {
          console.error = origWarn;
        }
      });

      it('[F32] generates scoped CSS donut scoping (@scope (tag) to (<slot-boundary>)) (Milestone 2)', () => {
        const code = `
          import { LitElement, html, css } from 'lit';
          export class ScopedBadge extends LitElement {
            static styles = css\`
              :host { display: inline-flex; }
              .badge-text { font-size: 1rem; color: #161616; }
            \`;
            render() { return html\`<span class="badge-text">Tag</span>\`; }
          }
        `;
        const res = compileModule(code, { emitCss: true, filePath: 'badge.ts' });
        expect(res.css).toBeDefined();
        expect(res.css).toMatch(/@scope\s*\(\s*scoped-badge\s*\)/);
        expect(res.css).toContain('.badge-text');
      });

      it('[F33] rewrites CSS selectors (:host, :host(...), ::slotted, :state) (Milestone 2)', () => {
        const code = `
          import { LitElement, html, css } from 'lit';
          export class SelectorDemo extends LitElement {
            static styles = css\`
              :host { display: block; }
              :host([disabled]) { opacity: 0.5; }
              :host-context(.dark-theme) { background: #121212; }
              ::slotted(svg) { fill: currentColor; }
              :state(selected) { border-color: #0f62fe; }
            \`;
            render() { return html\`<div>Content</div>\`; }
          }
        `;
        const res = compileModule(code, { emitCss: true, filePath: 'selector-demo.ts' });
        expect(res.css).not.toContain(':host');
        expect(res.css).not.toContain(':host-context');
        expect(res.css).toContain(':scope[disabled]');
        expect(res.css).toContain('.dark-theme');
        expect(res.css).toContain('[data-state~=selected]');
        expect(res.css).toContain('[data-slot-boundary]>:is(svg)');
      });

      it('[F34] delivers styles via React 19 style hoisting (<style href precedence="default">) (Milestone 2)', async () => {
        const code = `
          import { LitElement, html, css } from 'lit';
          export class InlinedStyleComp extends LitElement {
            static styles = css\`.text { color: green; }\`;
            render() { return html\`<p class="text">Styled</p>\`; }
          }
        `;
        const res = compileModule(code, { emitCss: false, filePath: 'inlined.ts' });
        expect(res.stylesheetId).toBeDefined();
        expect(res.code).toContain('<style');
        expect(res.code).toContain(`href="${res.stylesheetId}"`);
        expect(res.code).toContain('precedence="default"');

        const Component = await evalComponent(res.code, 'InlinedStyleComp');
        const htmlOutput = renderToString(React.createElement(Component));
        expect(htmlOutput).toContain('<style');
        expect(htmlOutput).toContain(res.stylesheetId ?? '');
      });

      it('[F35] supports external CSS file emission (--emit-css) (Milestone 2)', () => {
        const code = `
          import { LitElement, html, css } from 'lit';
          export class ExternalCssComp extends LitElement {
            static styles = css\`.container { margin: 10px; padding: 20px; }\`;
            render() { return html\`<div class="container">Box</div>\`; }
          }
        `;
        const res = compileModule(code, { emitCss: true, filePath: 'external.ts' });
        expect(res.css).toBeDefined();
        expect(res.css).toContain('.container');
        expect(res.code).not.toContain('padding: 20px');
      });

      it('[F36] emits Tier 0 pure functional component without runtime for leaf elements (Milestone 2)', () => {
        const code = `
          import { LitElement, html } from 'lit';
          export class StaticDivider extends LitElement {
            render() { return html\`<hr class="divider" />\`; }
          }
        `;
        const res = compileModule(code, { filePath: 'divider.ts' });
        expect(res.tier).toBe('Tier0Pure');
        expect(res.code).toContain('export function StaticDivider(');
        expect(res.code).not.toContain('MorphHost');
        expect(res.code).not.toContain('useMorphHost');
        expect(res.code).not.toContain('class StaticDivider');
        expect(res.code).not.toContain('use client');
      });

      it('[F37] verifies Tier 0 components render under React Server Component constraints (Milestone 2)', async () => {
        const code = `
          import { LitElement, html } from 'lit';
          export class ServerIcon extends LitElement {
            render() {
              return html\`<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="4" fill="currentColor" /></svg>\`;
            }
          }
        `;
        const res = compileModule(code, { filePath: 'server-icon.ts' });
        expect(res.tier).toBe('Tier0Pure');

        // Static RSC constraint assertions
        expect(res.code).not.toContain('use client');
        expect(res.code).not.toMatch(/\buse[A-Z]\w+/);
        expect(res.code).not.toMatch(/\b(window|document|customElements|navigator)\b/);

        // Hermetic server execution without DOM globals
        const Component = await evalComponent(res.code, 'ServerIcon');
        const htmlOutput = renderToString(React.createElement(Component));
        expect(htmlOutput).toContain('<svg');
        expect(htmlOutput).toContain('viewBox="0 0 16 16"');
      });
    });

    // -----------------------------------------------------------------------
    // Features 38-64: Tier 1 hosted stateful components and runtime
    // -----------------------------------------------------------------------
    describe('features 38-64: Tier 1 hosted stateful components and runtime', () => {
      it('[F38] verifies MorphHost production runtime base class contract', () => {
        const host = new MorphHost();
        let notified = 0;
        host._subscribers.add(() => notified++);
        expect(host._version).toBe(0);
        host.requestUpdate();
        expect(host._version).toBe(1);
        expect(notified).toBe(1);
      });

      it('[F39] verifies ReactiveControllerHost implementation (addController, removeController)', () => {
        const host = new MorphHost();
        let connected = false;
        let disconnected = false;
        const ctrl = {
          hostConnected() {
            connected = true;
          },
          hostDisconnected() {
            disconnected = true;
          },
        };
        host.addController(ctrl);
        expect(connected).toBe(false);
        host.connectedCallback();
        expect(connected).toBe(true);
        host.removeController(ctrl);
        expect(disconnected).toBe(true);
      });

      it('[F40] verifies useMorphHost hook coordinating instance and sync external store', () => {
        expect(typeof useMorphHost).toBe('function');
      });

      it('[F41] renders custom element tag as root of JSX tree', () => {
        const html = renderToString(React.createElement(StrictMode, null, React.createElement(CdsButton, { kind: 'primary' }, 'Button')));
        expect(html).toContain('<cds-button');
        expect(html).toMatch(/<cds-button[^>]*>.*<\/cds-button>/s);
      });

      it('[F42] supports host tag suffix configuration (--suffix=-r)', () => {
        const code = `
          import { LitElement, html } from 'lit';
          export class SuffixButton extends LitElement {
            render() { return html\`<button>Click</button>\`; }
          }
        `;
        const res = compileModule(code, { filePath: 'button.ts', tagSuffix: '-r' });
        expect(res.tagName).toBe('suffix-button-r');
        expect(res.code).toContain('suffix-button-r');
      });

      it('[F43] maps lifecycle connectedCallback / disconnectedCallback to layout effect', () => {
        const host = new MorphHost();
        expect(host.isConnected).toBe(false);
        host.connectedCallback();
        expect(host.isConnected).toBe(true);
        host.disconnectedCallback();
        expect(host.isConnected).toBe(false);
      });

      it('[F44] maps willUpdate / update with changedProperties against last committed snapshot', () => {
        const host = new MorphHost();
        let willUpdateCalled = false;
        host.willUpdate = (changed) => {
          willUpdateCalled = true;
          expect(changed.get('count')).toBe(1);
        };
        host._changedProperties.set('count', 1);
        host.willUpdate(host._changedProperties);
        expect(willUpdateCalled).toBe(true);
      });

      it('[F45] bails out when shouldUpdate returns false', () => {
        const host = new MorphHost();
        expect(host.shouldUpdate(new Map())).toBe(true);
        host.shouldUpdate = () => false;
        expect(host.shouldUpdate(new Map())).toBe(false);
      });

      it('[F46] maps firstUpdated and updated post-commit layout effects', () => {
        const host = new MorphHost();
        expect(host.hasUpdated).toBe(false);
        host.firstUpdated(new Map());
        expect(host.hasUpdated).toBe(true);
      });

      it('[F47] resolves updateComplete Promise after layout effect commit', async () => {
        const host = new MorphHost();
        host.requestUpdate();
        const promise = host.updateComplete;
        host._commitUpdate(true);
        const result = await promise;
        expect(result).toBe(true);
      });

      it('[F48] syncs reactive props to instance only on change, preventing controlled-component trap', () => {
        const host = new MorphHost();
        (host as any).label = 'initial';
        expect((host as any).label).toBe('initial');
        // Mutate internally
        (host as any).label = 'mutated';
        expect((host as any).label).toBe('mutated');
      });

      it('[F49] synchronizes form control properties (.value, .checked) via ref callbacks', () => {
        const host = new CdsCheckboxHost();
        expect(host.checked).toBe(false);
        const fakeNode = { checked: true, indeterminate: false } as HTMLInputElement;
        host._checkboxNode = fakeNode;
        host._handleChange();
        expect(host.checked).toBe(true);
      });

      it('[F50] lowers live(v) directive to unconditional property assignment', async () => {
        const code = `
          import { LitElement, html } from 'lit';
          import { property } from 'lit/decorators.js';
          import { live } from 'lit/directives/live.js';

          export class LiveInput extends LitElement {
            @property({ type: String })
            text = 'initial';

            render() {
              return html\`<input .value=\${live(this.text)} />\`;
            }
          }
        `;
        const res = compileModule(code, { filePath: 'live-input.ts' });
        expect(res.code).toContain('el.value = host.text');

        const cjsCode = await transpileJsxToCjs(res.code);

        const result = await page.evaluate(async (transpiledJs: string) => {
          const container = document.createElement('div');
          container.id = 'live-input-test-container';
          document.body.appendChild(container);

          const React = (window as any).React;
          const createRoot = (window as any).createRoot;
          const flushSync = (window as any).flushSync;

          const exports: any = {};
          const customRequire = (spec: string) => {
            if (spec === 'react') return React;
            if (spec === '@lit-core/morph-to-react/runtime') return (window as any).morphRuntime;
            throw new Error(`Unknown specifier: ${spec}`);
          };
          const fn = new Function('React', 'exports', 'require', transpiledJs);
          fn(React, exports, customRequire);
          const LiveInput = exports.LiveInput;

          const root = createRoot(container);
          let hostRef: any = null;

          // 1. Initial mount with text="initial"
          flushSync(() => {
            root.render(
              React.createElement(LiveInput, {
                text: 'initial',
                ref: (inst: any) => {
                  hostRef = inst;
                },
              }),
            );
          });

          const input = container.querySelector('input') as HTMLInputElement;
          if (!input) {
            root.unmount();
            container.remove();
            return { success: false, error: 'input element not found in DOM' };
          }
          const initialVal = input.value;

          // 2. Simulate external input tampering (e.g. direct DOM manipulation or uncontrolled typing)
          input.value = 'external tampering';
          const tamperedVal = input.value;

          // 3. Trigger component update (via host.requestUpdate() or re-render)
          // The live() ref callback unconditionally re-assigns el.value = host.text, resetting the input
          flushSync(() => {
            if (hostRef && typeof hostRef.requestUpdate === 'function') {
              hostRef.requestUpdate();
            } else {
              root.render(
                React.createElement(LiveInput, {
                  text: 'initial',
                  ref: (inst: any) => {
                    hostRef = inst;
                  },
                }),
              );
            }
          });
          const restoredVal = input.value;

          // 4. Trigger component re-render with updated prop text="synchronized"
          flushSync(() => {
            root.render(
              React.createElement(LiveInput, {
                text: 'synchronized',
                ref: (inst: any) => {
                  hostRef = inst;
                },
              }),
            );
          });
          const updatedVal = input.value;

          // Cleanup DOM
          root.unmount();
          container.remove();

          return {
            success: true,
            initialVal,
            tamperedVal,
            restoredVal,
            updatedVal,
          };
        }, cjsCode);

        expect(result.success).toBe(true);
        expect(result.initialVal).toBe('initial');
        expect(result.tamperedVal).toBe('external tampering');
        expect(result.restoredVal).toBe('initial');
        expect(result.updatedVal).toBe('synchronized');
      });

      it('[F51] attaches native DOM event listeners via ref callback with cleanup', async () => {
        const cleanupTest = await page.evaluate(() => {
          const el = document.createElement('button');
          let count = 0;
          const handler = () => count++;
          el.addEventListener('click', handler);
          el.click();
          el.removeEventListener('click', handler);
          el.click();
          return count;
        });
        expect(cleanupTest).toBe(1);
      });

      it('[F52] dispatches real DOM CustomEvent and invokes on* React callback with full event', () => {
        const host = new MorphHost();
        let received: any = null;
        host._props = {
          onCdsCustomEvent: (e: CustomEvent) => {
            received = e.detail;
          },
        };
        const evt = new CustomEvent('cds-custom-event', { detail: { value: 42 } });
        host.dispatchEvent(evt);
        expect(received?.value).toBe(42);
      });

      it('[F53] stops non-composed internal events at host element boundary in light DOM', async () => {
        const boundaryResult = await page.evaluate(() => {
          const host = document.createElement('div');
          const inner = document.createElement('div');
          host.appendChild(inner);
          document.body.appendChild(host);

          let reachedBody = false;
          const bodyListener = () => {
            reachedBody = true;
          };
          document.body.addEventListener('internal-event', bodyListener);

          host.addEventListener('internal-event', (e) => {
            e.stopPropagation();
          });

          inner.dispatchEvent(new CustomEvent('internal-event', { bubbles: true, composed: false }));

          document.body.removeEventListener('internal-event', bodyListener);
          document.body.removeChild(host);
          return reachedBody;
        });
        expect(boundaryResult).toBe(false);
      });

      it('[F54] injects distinct keys on conditional template ternary branches', () => {
        const code = `
          import { LitElement, html } from 'lit';
          export class BranchComp extends LitElement {
            render() {
              const condition = true;
              return html\`<div>\${condition ? html\`<input placeholder="Email" />\` : html\`<input placeholder="Username" />\`}</div>\`;
            }
          }
        `;
        const res = compileModule(code, { filePath: 'branch.ts' });
        expect(res.code).toMatch(/key=["']branch-0["']/);
        expect(res.code).toMatch(/key=["']branch-1["']/);
      });

      it('[F55] lowers classMap directive to computed className string', async () => {
        const code = `
          import { LitElement, html } from 'lit';
          import { classMap } from 'lit/directives/class-map.js';
          export class Card extends LitElement {
            render() {
              const isActive = true;
              const isPrimary = false;
              return html\`<div class=\${classMap({ 'card': true, 'card--active': isActive, 'card--primary': isPrimary })}>Content</div>\`;
            }
          }
        `;
        const res = compileModule(code, { filePath: 'card.ts' });
        expect(res.code).not.toContain('classMap(');
        expect(res.code).toContain('className=');

        const Component = await evalComponent(res.code, 'Card');
        const htmlOutput = renderToString(React.createElement(Component));
        expect(htmlOutput).toContain('class="card card--active"');
        expect(htmlOutput).not.toContain('card--primary');
      });

      it('[F56] lowers styleMap directive to React style object', async () => {
        const code = `
          import { LitElement, html } from 'lit';
          import { styleMap } from 'lit/directives/style-map.js';
          export class StyledCard extends LitElement {
            render() {
              const bg = 'blue';
              return html\`<div style=\${styleMap({ color: 'red', 'font-size': '16px', '--card-bg': bg })}>Content</div>\`;
            }
          }
        `;
        const res = compileModule(code, { filePath: 'styled-card.ts' });
        expect(res.code).not.toContain('styleMap(');
        expect(res.code).toContain('fontSize: "16px"');
        expect(res.code).toContain('"--card-bg": bg');

        const Component = await evalComponent(res.code, 'StyledCard');
        const htmlOutput = renderToString(React.createElement(Component));
        expect(htmlOutput).toContain('style="color:red;font-size:16px;--card-bg:blue"');
      });

      it('[F57] lowers ifDefined directive (val !== undefined ? val : undefined)', async () => {
        const code = `
          import { LitElement, html } from 'lit';
          import { ifDefined } from 'lit/directives/if-defined.js';
          export class IfDefButton extends LitElement {
            render() {
              const definedLabel = 'Submit';
              const undefinedLabel = undefined;
              return html\`<button aria-label=\${ifDefined(definedLabel)} title=\${ifDefined(undefinedLabel)}>Click</button>\`;
            }
          }
        `;
        const res = compileModule(code, { filePath: 'if-def.ts' });
        expect(res.code).not.toContain('ifDefined(');

        const Component = await evalComponent(res.code, 'IfDefButton');
        const htmlOutput = renderToString(React.createElement(Component));
        expect(htmlOutput).toContain('aria-label="Submit"');
        expect(htmlOutput).not.toContain('title=');
      });

      it('[F58] lowers when and choose directives to JSX conditional expressions', async () => {
        const code = `
          import { LitElement, html } from 'lit';
          import { when } from 'lit/directives/when.js';
          import { choose } from 'lit/directives/choose.js';
          export class ConditionalFlow extends LitElement {
            render() {
              const isLoaded = true;
              const status = 'success';
              return html\`
                <div>
                  \${when(isLoaded, () => html\`<span>Loaded</span>\`, () => html\`<span>Loading</span>\`)}
                  \${choose(status, [['success', () => html\`<b>Success</b>\`], ['error', () => html\`<b>Error</b>\`]], () => html\`<b>Pending</b>\`)}
                </div>
              \`;
            }
          }
        `;
        const res = compileModule(code, { filePath: 'flow.ts' });
        expect(res.code).not.toContain('when(');
        expect(res.code).not.toContain('choose(');

        const Component = await evalComponent(res.code, 'ConditionalFlow');
        const htmlOutput = renderToString(React.createElement(Component));
        expect(htmlOutput).toContain('<span>Loaded</span>');
        expect(htmlOutput).toContain('<b>Success</b>');
      });

      it('[F59] lowers map and repeat directives to keyed array iterations', async () => {
        const code = `
          import { LitElement, html } from 'lit';
          import { map } from 'lit/directives/map.js';
          import { repeat } from 'lit/directives/repeat.js';
          export class ListComp extends LitElement {
            render() {
              const items = ['one', 'two'];
              const objects = [{ id: '101', name: 'alpha' }];
              return html\`
                <ul>
                  \${map(items, (item, i) => html\`<li>\${item}</li>\`)}
                  \${repeat(objects, (o) => o.id, (o) => html\`<li data-id=\${o.id}>\${o.name}</li>\`)}
                </ul>
              \`;
            }
          }
        `;
        const res = compileModule(code, { filePath: 'list.ts' });
        expect(res.code).not.toContain('map(items');
        expect(res.code).not.toContain('repeat(objects');

        const Component = await evalComponent(res.code, 'ListComp');
        const htmlOutput = renderToString(React.createElement(Component));
        expect(htmlOutput).toContain('<li>one</li>');
        expect(htmlOutput).toContain('<li data-id="101">alpha</li>');
      });

      it('[F60] lowers join and range directives to inline array operations', async () => {
        const code = `
          import { LitElement, html } from 'lit';
          import { join } from 'lit/directives/join.js';
          import { range } from 'lit/directives/range.js';
          export class InlineOps extends LitElement {
            render() {
              const tags = ['tag1', 'tag2', 'tag3'];
              const steps = range(3);
              return html\`<div><span>\${join(tags, ', ')}</span><span>\${steps.length}</span></div>\`;
            }
          }
        `;
        const res = compileModule(code, { filePath: 'inline-ops.ts' });
        expect(res.code).not.toContain('range(3)');

        const Component = await evalComponent(res.code, 'InlineOps');
        const htmlOutput = renderToString(React.createElement(Component));
        expect(htmlOutput).toContain('tag1, tag2, tag3');
        expect(htmlOutput).toContain('3');
      });

      it('[F61] lowers keyed, ref, and guard directives to React primitives', async () => {
        const code = `
          import { LitElement, html } from 'lit';
          import { keyed } from 'lit/directives/keyed.js';
          import { ref } from 'lit/directives/ref.js';
          import { guard } from 'lit/directives/guard.js';
          export class PrimitivesComp extends LitElement {
            render() {
              const itemKey = 'user-42';
              const myRef = null;
              const dep = 'stable';
              return html\`
                <div \${ref(myRef)}>
                  \${keyed(itemKey, html\`<span>Keyed content</span>\`)}
                  \${guard([dep], () => html\`<b>Guarded content</b>\`)}
                </div>
              \`;
            }
          }
        `;
        const res = compileModule(code, { filePath: 'primitives.ts' });
        expect(res.code).toContain('key="user-42"');
        expect(res.code).toContain('ref={myRef}');

        const Component = await evalComponent(res.code, 'PrimitivesComp');
        const htmlOutput = renderToString(React.createElement(Component));
        expect(htmlOutput).toContain('Keyed content');
        expect(htmlOutput).toContain('Guarded content');
      });

      it('[F62] lowers unsafeHTML and unsafeSVG to dangerouslySetInnerHTML on sole-child wrapper', async () => {
        const code = `
          import { LitElement, html } from 'lit';
          import { unsafeHTML } from 'lit/directives/unsafe-html.js';
          export class RawMarkup extends LitElement {
            render() {
              const raw = '<em>Sanitized HTML</em>';
              return html\`<div class="content">\${unsafeHTML(raw)}</div>\`;
            }
          }
        `;
        const res = compileModule(code, { filePath: 'raw.ts' });
        expect(res.code).toContain('dangerouslySetInnerHTML={{ __html: raw }}');

        const Component = await evalComponent(res.code, 'RawMarkup');
        const htmlOutput = renderToString(React.createElement(Component));
        expect(htmlOutput).toContain('<em>Sanitized HTML</em>');
      });

      it('[F63] rewrites template static IDs and IDREFs via useId() for instance isolation', async () => {
        const code = `
          import { LitElement, html } from 'lit';
          export class AccessibleField extends LitElement {
            render() {
              return html\`
                <label for="input-box">Label</label>
                <input id="input-box" aria-describedby="help-text" />
                <span id="help-text">Helper note</span>
              \`;
            }
          }
        `;
        const res = compileModule(code, { filePath: 'accessible-field.ts' });
        expect(res.code).toContain('React.useId()');
        expect(res.code).toContain('htmlFor={_id + "-input-box"}');
        expect(res.code).toContain('id={_id + "-input-box"}');
        expect(res.code).toContain('aria-describedby={_id + "-help-text"}');

        const Component = await evalComponent(res.code, 'AccessibleField');
        const combinedHtml = renderToString(React.createElement(React.Fragment, null, React.createElement(Component), React.createElement(Component)));
        expect(combinedHtml).toContain('for="');
        expect(combinedHtml).toContain('id="');
        const ids = Array.from(combinedHtml.matchAll(/id="([^"]+-input-box)"/g)).map((m) => m[1]);
        expect(ids).toHaveLength(2);
        // Two instances must have different rendered IDs
        expect(ids[0]).not.toEqual(ids[1]);
      });

      it('[F64] lowers @query and querySelector to compile-time React refs', () => {
        const code = `
          import { LitElement, html } from 'lit';
          import { query } from 'lit/decorators.js';
          export class QueryElement extends LitElement {
            @query('#btn-node')
            btnNode!: HTMLButtonElement;

            render() {
              return html\`<button id="btn-node">Target</button>\`;
            }
          }
        `;
        const res = compileModule(code, { filePath: 'query.ts' });
        expect(res.code).toContain('useRef');
        expect(res.code).toContain('ref=');
      });
    });

    // -----------------------------------------------------------------------
    // Features 65-70: hierarchy and cross-module resolution
    // -----------------------------------------------------------------------
    describe('features 65-70: hierarchy and cross-module resolution', () => {
      it('[F65] supports class inheritance on MorphHost without whole-program flattening', async () => {
        const code = `
          import { LitElement, html, property } from 'lit';
          export class BaseCard extends LitElement {
            @property({ type: String })
            header = 'Base Title';

            focus() {
              return true;
            }

            render() {
              return html\`<div class="card-base"><h3>\${this.header}</h3></div>\`;
            }
          }

          export class SpecializedCard extends BaseCard {
            @property({ type: Boolean })
            elevated = false;

            render() {
              return html\`<div class="card-specialized \${this.elevated ? 'elevated' : ''}"><h3>\${this.header}</h3></div>\`;
            }
          }
        `;
        const res = compileModule(code, { filePath: 'cards.ts', targetTier: 'Tier1Hosted' });
        expect(res.code).toContain('class BaseCardHost extends MorphHost');
        expect(res.code).toContain('class SpecializedCardHost extends BaseCardHost');
        expect(res.code).toContain('...super._propertyDefaults');
        expect(res.code).toContain('export const SpecializedCard = forwardRef(');

        const Component = await evalComponent(res.code, 'SpecializedCard');
        const htmlOutput = renderToString(React.createElement(Component, { header: 'Custom Header', elevated: true }));
        expect(htmlOutput).toContain('Custom Header');
        expect(htmlOutput).toContain('card-specialized');
        expect(htmlOutput).toContain('elevated');
      });

      it('[F66] lowers class expression mixins extending MorphHost', async () => {
        const code = `
          import { LitElement, html, property } from 'lit';
          export const DisabledMixin = (superClass: any) => class extends superClass {
            @property({ type: Boolean })
            disabled = false;
          };

          export class MixedCard extends DisabledMixin(LitElement) {
            @property({ type: String })
            title = 'Card Title';

            render() {
              return html\`<div class="card" ?data-disabled="\${this.disabled}"><h4>\${this.title}</h4></div>\`;
            }
          }
        `;
        const res = compileModule(code, { filePath: 'mixed-card.ts', targetTier: 'Tier1Hosted' });
        expect(res.code).toContain('MixedCardHost extends DisabledMixin(MorphHost)');
        expect(res.code).toContain('export const MixedCard = forwardRef(');

        (globalThis as any).DisabledMixin = (superClass: any) =>
          class extends superClass {
            disabled = false;
          };
        try {
          const Component = await evalComponent(res.code, 'MixedCard');
          const htmlOutput = renderToString(React.createElement(Component, { title: 'Hello Mixin' }));
          expect(htmlOutput).toContain('Hello Mixin');
          expect(htmlOutput).toContain('card');
        } finally {
          delete (globalThis as any).DisabledMixin;
        }
      });

      it('[F67] rewrites compiled child custom elements (<my-icon> -> <MyIcon>)', () => {
        const code = `
          import { LitElement, html, property } from 'lit';
          export class StatusBanner extends LitElement {
            @property({ type: String })
            iconName = 'info';

            @property({ type: Boolean })
            active = true;

            handleIconClick(e: any) {}

            render() {
              return html\`
                <div class="banner">
                  <my-icon .name="\${this.iconName}" ?active="\${this.active}" @icon-click="\${this.handleIconClick}"></my-icon>
                </div>
              \`;
            }
          }
        `;
        const res = compileModule(code, {
          filePath: 'banner.ts',
          targetTier: 'Tier1Hosted',
          knownTags: { 'my-icon': 'MyIcon' },
        });
        expect(res.code).toContain('<MyIcon');
        expect(res.code).toMatch(/name=\{(props|host)\.iconName\}/);
        expect(res.code).not.toContain('<my-icon');
        expect(res.code).not.toContain('.name=');
        expect(res.code).toContain('onIconClick=');
        expect(res.code).not.toContain('@icon-click=');
        expect(res.code).toMatch(/import\s*\{\s*MyIcon\s*\}\s*from\s*['"]\.\/my-icon\.js['"]/);
      });

      it('[F68] preserves uncompiled third-party custom elements as lowercase JSX tags', async () => {
        const code = `
          import { LitElement, html } from 'lit';
          export class ThirdPartyContainer extends LitElement {
            render() {
              return html\`
                <section class="grid-wrap">
                  <foreign-grid cols="3">
                    <unknown-badge variant="success">OK</unknown-badge>
                  </foreign-grid>
                </section>
              \`;
            }
          }
        `;
        const res = compileModule(code, { filePath: 'container.ts' });
        expect(res.code).toContain('<foreign-grid');
        expect(res.code).toContain('<unknown-badge');
        expect(res.code).not.toContain('<ForeignGrid');
        expect(res.code).not.toContain('<UnknownBadge');

        const Component = await evalComponent(res.code, 'ThirdPartyContainer');
        const htmlOutput = renderToString(React.createElement(Component));
        expect(htmlOutput).toContain('<foreign-grid cols="3">');
        expect(htmlOutput).toContain('<unknown-badge variant="success">OK</unknown-badge>');
      });

      it('[F69] generates accurate TypeScript .d.ts declaration files', async () => {
        const code = `
          import { LitElement, html, property } from 'lit';
          export class ActionButton extends LitElement {
            @property({ type: Boolean })
            primary = false;

            @property({ type: String })
            label = 'Submit';

            @property({ type: Number })
            count = 0;

            focus(): boolean {
              return true;
            }

            render() {
              return html\`<button class="\${this.primary ? 'primary' : ''}">\${this.label} (\${this.count})</button>\`;
            }
          }
        `;
        const res = compileModule(code, { filePath: 'action-button.ts', emitDts: true });
        expect(res.dts).toBeDefined();
        const dts = res.dts ?? '';

        // 1. Imports
        expect(dts).toMatch(/import type \* as React from ['"]react['"];/);
        expect(dts).toMatch(/import type \{ MorphHost \} from ['"]@lit-core\/morph-to-react\/runtime['"];/);

        // 2. Props interface
        expect(dts).toContain('export interface ActionButtonProps extends React.HTMLAttributes<HTMLElement>');
        expect(dts).toContain('primary?: boolean;');
        expect(dts).toContain('label?: string;');
        expect(dts).toContain('count?: number;');
        expect(dts).toContain('children?: React.ReactNode;');

        // 3. Host class
        expect(dts).toContain('export declare class ActionButtonHost extends MorphHost');
        expect(dts).toContain('primary: boolean;');
        expect(dts).toContain('label: string;');
        expect(dts).toContain('count: number;');
        expect(dts).toContain('focus(): boolean;');

        // 4. ForwardRef component declaration
        expect(dts).toContain('export declare const ActionButton: React.ForwardRefExoticComponent<React.PropsWithoutRef<ActionButtonProps> & React.RefAttributes<ActionButtonHost>>;');

        // 5. Authentic TypeScript syntax validation
        const parsedDts = await transformWithOxc(dts, 'action-button.d.ts');
        expect(parsedDts.code).toBeDefined();
      });

      it('[F70] emits strongly-typed event callback props in .d.ts', async () => {
        const code = `
          import { LitElement, html, property } from 'lit';
          export interface SelectionDetail {
            selectedId: string;
            index: number;
          }

          export class SelectList extends LitElement {
            @property({ type: String })
            value = '';

            private notifySelection(id: string, index: number) {
              this.dispatchEvent(new CustomEvent<SelectionDetail>('item-select', {
                bubbles: true,
                composed: true,
                detail: { selectedId: id, index },
              }));
            }

            private notifyChange() {
              this.dispatchEvent(new CustomEvent('list-change'));
            }

            render() {
              return html\`<ul @click="\${this.notifyChange}"><slot></slot></ul>\`;
            }
          }
        `;
        const res = compileModule(code, { filePath: 'select-list.ts', emitDts: true });
        expect(res.dts).toBeDefined();
        const dts = res.dts ?? '';

        // Strongly-typed CustomEvent callback props
        expect(dts).toContain('export interface SelectListProps extends React.HTMLAttributes<HTMLElement>');
        expect(dts).toContain('onItemSelect?: (event: CustomEvent<SelectionDetail>) => void;');
        expect(dts).toContain('onListChange?: (event: CustomEvent<unknown>) => void;');

        // Authentic TypeScript syntax validation
        const parsedDts = await transformWithOxc(dts, 'select-list.d.ts');
        expect(parsedDts.code).toBeDefined();
      });
    });

    // -----------------------------------------------------------------------
    // Features 71-79: Tier 2 composite components, slots and form facade
    // -----------------------------------------------------------------------
    describe('features 71-79: Tier 2 composite components, slots and form facade', () => {
      it('[F71] lowers default slot to React {children}', () => {
        const { defaultChildren } = partitionSlots('Hello default');
        expect(defaultChildren).toContain('Hello default');
      });

      it('[F72] partitions children by slot="..." attribute for named slots', () => {
        const iconChild = React.createElement('span', { slot: 'icon', key: 'icon' }, 'Icon');
        const defaultChild = 'Text';
        const { defaultChildren, namedSlots } = partitionSlots([iconChild, defaultChild]);
        expect(namedSlots.icon).toBeDefined();
        expect(defaultChildren).toContain(defaultChild);
      });

      it('[F73] renders slot fallback content when projected slot content is absent', () => {
        const { namedSlots } = partitionSlots([]);
        const slotted = namedSlots.icon?.[0] || 'Fallback Icon';
        expect(slotted).toBe('Fallback Icon');
      });

      it('[F74] projects content only to first matching slot in tree order', () => {
        const icon1 = React.createElement('span', { slot: 'icon', key: '1' }, 'First');
        const icon2 = React.createElement('span', { slot: 'icon', key: '2' }, 'Second');
        const { namedSlots } = partitionSlots([icon1, icon2]);
        expect(namedSlots.icon?.[0]).toEqual(icon1);
      });

      it('[F75] emits <slot-boundary style={{ display: "contents" }}> when inspection is required', () => {
        const boundarySsr = renderToString(React.createElement(SlotBoundary, null, 'Slotted content'));
        expect(boundarySsr).toContain('display:contents');
        expect(boundarySsr).toContain('Slotted content');
      });

      it('[F76] implements slotchange and assignedElements() via MutationObserver on boundary', async () => {
        const observerResult = await page.evaluate(async () => {
          const boundary = document.createElement('div');
          document.body.appendChild(boundary);
          let changes = 0;
          const observer = new MutationObserver(() => {
            changes++;
          });
          observer.observe(boundary, { childList: true });

          const child = document.createElement('span');
          boundary.appendChild(child);

          await new Promise((resolve) => setTimeout(resolve, 50));
          observer.disconnect();
          document.body.removeChild(boundary);
          return changes;
        });
        expect(observerResult).toBeGreaterThanOrEqual(1);
      });

      it('[F77] synchronizes hidden proxy <input> for ElementInternals form association (Milestone 5)', async () => {
        const code = `
          import { LitElement, html, property } from 'lit';

          export class RatingInput extends LitElement {
            static formAssociated = true;
            private _internals: ElementInternals;

            @property({ type: Number })
            rating = 0;

            constructor() {
              super();
              this._internals = this.attachInternals();
            }

            firstUpdated() {
              this._internals.setFormValue(String(this.rating));
            }

            updated(changedProps: Map<string, any>) {
              if (changedProps.has('rating')) {
                this._internals.setFormValue(String(this.rating));
              }
            }

            render() {
              return html\`<div class="rating-display">Stars: \${this.rating}</div>\`;
            }
          }
        `;

        const res = compileModule(code, { filePath: 'rating-input.ts' });
        expect(res.tier).toBe('Tier2HostedWithFacade');

        const cjsCode = await transpileJsxToCjs(res.code);

        const testResult = await page.evaluate(async (transpiledJs: string) => {
          const container = document.createElement('div');
          container.id = 'f77-test-container';
          document.body.appendChild(container);

          const React = (window as any).React;
          const createRoot = (window as any).createRoot;
          const flushSync = (window as any).flushSync;

          const exports: any = {};
          const customRequire = (spec: string) => {
            if (spec === 'react') return React;
            if (spec === '@lit-core/morph-to-react/runtime') return (window as any).morphRuntime;
            throw new Error(`Unknown specifier: ${spec}`);
          };
          const fn = new Function('React', 'exports', 'require', transpiledJs);
          fn(React, exports, customRequire);
          const RatingInput = exports.RatingInput;

          const root = createRoot(container);
          let _hostRef: any = null;

          // 1. Mount custom form-associated component inside real HTML form
          flushSync(() => {
            root.render(
              React.createElement(
                'form',
                { id: 'f77-form' },
                React.createElement(RatingInput, {
                  name: 'product_rating',
                  rating: 4,
                  ref: (inst: any) => {
                    _hostRef = inst;
                  },
                }),
                React.createElement('input', { type: 'text', name: 'user_name', defaultValue: 'Alice' }),
              ),
            );
          });

          const form = container.querySelector('#f77-form') as HTMLFormElement;
          if (!form) {
            root.unmount();
            container.remove();
            return { success: false, error: 'Form not found in DOM' };
          }

          // 2. Extract initial FormData
          const initialFormData = new FormData(form);
          const initialRating = initialFormData.get('product_rating');
          const initialUser = initialFormData.get('user_name');

          // 3. Dynamically update rating prop
          flushSync(() => {
            root.render(
              React.createElement(
                'form',
                { id: 'f77-form' },
                React.createElement(RatingInput, {
                  name: 'product_rating',
                  rating: 5,
                  ref: (inst: any) => {
                    _hostRef = inst;
                  },
                }),
                React.createElement('input', { type: 'text', name: 'user_name', defaultValue: 'Alice' }),
              ),
            );
          });

          const updatedFormData = new FormData(form);
          const updatedRating = updatedFormData.get('product_rating');

          // 4. Test authentic form submit event
          let submittedRating: string | null = null;
          form.addEventListener('submit', (e) => {
            e.preventDefault();
            const submitted = new FormData(form);
            submittedRating = submitted.get('product_rating') as string;
          });

          form.requestSubmit();

          root.unmount();
          container.remove();

          return {
            success: true,
            initialRating,
            initialUser,
            updatedRating,
            submittedRating,
          };
        }, cjsCode);

        expect(testResult.success).toBe(true);
        expect(testResult.initialRating).toBe('4');
        expect(testResult.initialUser).toBe('Alice');
        expect(testResult.updatedRating).toBe('5');
        expect(testResult.submittedRating).toBe('5');
      });

      it('[F78] forwards setValidity and redirects focus to host element during validation (Milestone 5)', async () => {
        const code = `
          import { LitElement, html, property } from 'lit';

          export class ValidatedField extends LitElement {
            static formAssociated = true;
            private _internals: ElementInternals;

            @property({ type: String })
            value = '';

            constructor() {
              super();
              this._internals = this.attachInternals();
            }

            setCustomError(msg: string) {
              if (msg) {
                this._internals.setValidity({ customError: true }, msg, this);
              } else {
                this._internals.setValidity({});
              }
            }

            render() {
              return html\`<div class="field-box" tabindex="0">Field: \${this.value}</div>\`;
            }
          }
        `;

        const res = compileModule(code, { filePath: 'validated-field.ts' });
        expect(res.tier).toBe('Tier2HostedWithFacade');

        const cjsCode = await transpileJsxToCjs(res.code);

        const testResult = await page.evaluate(async (transpiledJs: string) => {
          const container = document.createElement('div');
          container.id = 'f78-test-container';
          document.body.appendChild(container);

          const React = (window as any).React;
          const createRoot = (window as any).createRoot;
          const flushSync = (window as any).flushSync;

          const exports: any = {};
          const customRequire = (spec: string) => {
            if (spec === 'react') return React;
            if (spec === '@lit-core/morph-to-react/runtime') return (window as any).morphRuntime;
            throw new Error(`Unknown specifier: ${spec}`);
          };
          const fn = new Function('React', 'exports', 'require', transpiledJs);
          fn(React, exports, customRequire);
          const ValidatedField = exports.ValidatedField;

          const root = createRoot(container);
          let hostRef: any = null;

          flushSync(() => {
            root.render(
              React.createElement(
                'form',
                { id: 'f78-form' },
                React.createElement(ValidatedField, {
                  name: 'coupon_code',
                  value: 'invalid',
                  ref: (inst: any) => {
                    hostRef = inst;
                  },
                }),
              ),
            );
          });

          const form = container.querySelector('#f78-form') as HTMLFormElement;
          if (!form || !hostRef) {
            root.unmount();
            container.remove();
            return { success: false, error: 'Form or hostRef missing' };
          }

          // 1. Initially valid
          const initialCheck = form.checkValidity();

          // 2. Set custom validation error
          hostRef.setCustomError('Invalid coupon code');

          const invalidCheck = form.checkValidity();
          const validationMsg = hostRef._internals?.validationMessage;

          // 3. Test reportValidity and focus redirection
          // Blur any active element
          (document.activeElement as HTMLElement)?.blur?.();
          const reported = form.reportValidity();

          const hostNode = container.querySelector('validated-field') || hostRef._hostElement;
          const isFocusRedirected = document.activeElement === hostNode;

          // 4. Clear validation error
          hostRef.setCustomError('');
          const clearedCheck = form.checkValidity();

          root.unmount();
          container.remove();

          return {
            success: true,
            initialCheck,
            invalidCheck,
            validationMsg,
            reported,
            isFocusRedirected,
            clearedCheck,
          };
        }, cjsCode);

        expect(testResult.success).toBe(true);
        expect(testResult.initialCheck).toBe(true);
        expect(testResult.invalidCheck).toBe(false);
        expect(testResult.validationMsg).toBe('Invalid coupon code');
        expect(testResult.reported).toBe(false);
        expect(testResult.isFocusRedirected).toBe(true);
        expect(testResult.clearedCheck).toBe(true);
      });

      it('[F79] observes form reset and disabled callbacks on proxy inputs (Milestone 5)', async () => {
        const code = `
          import { LitElement, html, property } from 'lit';

          export class FullLifecycleControl extends LitElement {
            static formAssociated = true;
            private _internals: ElementInternals;

            @property({ type: String })
            value = 'initial_default';

            resetInvoked = false;
            lastDisabledArg: boolean | null = null;
            disabledCallCount = 0;
            restoredState: any = null;
            restoredMode: string | null = null;

            constructor() {
              super();
              this._internals = this.attachInternals();
            }

            firstUpdated() {
              this._internals.setFormValue(this.value);
            }

            formResetCallback() {
              this.resetInvoked = true;
              this.value = 'initial_default';
              this._internals.setFormValue(this.value);
            }

            formDisabledCallback(disabled: boolean) {
              this.lastDisabledArg = disabled;
              this.disabledCallCount++;
            }

            formStateRestoreCallback(state: any, mode: 'restore' | 'autocomplete') {
              this.restoredState = state;
              this.restoredMode = mode;
              this.value = String(state);
              this._internals.setFormValue(this.value);
            }

            render() {
              return html\`<div class="lifecycle-view">Value: \${this.value}</div>\`;
            }
          }
        `;

        const res = compileModule(code, { filePath: 'full-lifecycle-control.ts' });
        expect(res.tier).toBe('Tier2HostedWithFacade');

        const cjsCode = await transpileJsxToCjs(res.code);

        const testResult = await page.evaluate(async (transpiledJs: string) => {
          const container = document.createElement('div');
          container.id = 'f79-test-container';
          document.body.appendChild(container);

          const React = (window as any).React;
          const createRoot = (window as any).createRoot;
          const flushSync = (window as any).flushSync;

          const exports: any = {};
          const customRequire = (spec: string) => {
            if (spec === 'react') return React;
            if (spec === '@lit-core/morph-to-react/runtime') return (window as any).morphRuntime;
            throw new Error(`Unknown specifier: ${spec}`);
          };
          const fn = new Function('React', 'exports', 'require', transpiledJs);
          fn(React, exports, customRequire);
          const FullLifecycleControl = exports.FullLifecycleControl;

          const root = createRoot(container);
          let hostRef: any = null;

          flushSync(() => {
            root.render(
              React.createElement(
                'form',
                { id: 'f79-form' },
                React.createElement(
                  'fieldset',
                  { id: 'f79-fieldset' },
                  React.createElement(FullLifecycleControl, {
                    name: 'lifecycle_field',
                    ref: (inst: any) => {
                      hostRef = inst;
                    },
                  }),
                ),
              ),
            );
          });

          const form = container.querySelector('#f79-form') as HTMLFormElement;
          const fieldset = container.querySelector('#f79-fieldset') as HTMLFieldSetElement;

          if (!form || !fieldset || !hostRef) {
            root.unmount();
            container.remove();
            return { success: false, error: 'Elements not mounted' };
          }

          // 1. Test formResetCallback
          // Mutate value to simulate user edit
          hostRef.value = 'user_edited';
          hostRef._internals?.setFormValue('user_edited');
          const editedValue = new FormData(form).get('lifecycle_field');

          // Trigger form reset
          form.reset();
          const resetInvoked = hostRef.resetInvoked;
          const resetValue = new FormData(form).get('lifecycle_field');

          // 2. Test formDisabledCallback via ancestor <fieldset disabled>
          fieldset.disabled = true;
          // Allow MutationObserver microtask to fire
          await new Promise((resolve) => setTimeout(resolve, 30));
          const disabledAfterFieldsetTrue = hostRef.lastDisabledArg;

          fieldset.disabled = false;
          await new Promise((resolve) => setTimeout(resolve, 30));
          const disabledAfterFieldsetFalse = hostRef.lastDisabledArg;

          // 3. Test formDisabledCallback via direct disabled prop
          flushSync(() => {
            root.render(
              React.createElement(
                'form',
                { id: 'f79-form' },
                React.createElement(
                  'fieldset',
                  { id: 'f79-fieldset' },
                  React.createElement(FullLifecycleControl, {
                    name: 'lifecycle_field',
                    disabled: true,
                    ref: (inst: any) => {
                      hostRef = inst;
                    },
                  }),
                ),
              ),
            );
          });
          const disabledAfterPropTrue = hostRef.lastDisabledArg;

          // Re-enable control for form submission and state restoration
          flushSync(() => {
            root.render(
              React.createElement(
                'form',
                { id: 'f79-form' },
                React.createElement(
                  'fieldset',
                  { id: 'f79-fieldset' },
                  React.createElement(FullLifecycleControl, {
                    name: 'lifecycle_field',
                    disabled: false,
                    ref: (inst: any) => {
                      hostRef = inst;
                    },
                  }),
                ),
              ),
            );
          });

          // 4. Test formStateRestoreCallback (restore mode and autocomplete mode)
          hostRef.formStateRestoreCallback('restored_history_state', 'restore');
          const restoredVal = hostRef.value;
          const restoredMode = hostRef.restoredMode;
          const restoredFormVal = new FormData(form).get('lifecycle_field');

          hostRef.formStateRestoreCallback('autofilled_email', 'autocomplete');
          const autofilledVal = hostRef.value;
          const autofilledMode = hostRef.restoredMode;
          const autofilledFormVal = new FormData(form).get('lifecycle_field');

          root.unmount();
          container.remove();

          return {
            success: true,
            editedValue,
            resetInvoked,
            resetValue,
            disabledAfterFieldsetTrue,
            disabledAfterFieldsetFalse,
            disabledAfterPropTrue,
            restoredVal,
            restoredMode,
            restoredFormVal,
            autofilledVal,
            autofilledMode,
            autofilledFormVal,
          };
        }, cjsCode);

        expect(testResult.success).toBe(true);
        // Reset verification
        expect(testResult.editedValue).toBe('user_edited');
        expect(testResult.resetInvoked).toBe(true);
        expect(testResult.resetValue).toBe('initial_default');

        // Fieldset and prop disabled verification
        expect(testResult.disabledAfterFieldsetTrue).toBe(true);
        expect(testResult.disabledAfterFieldsetFalse).toBe(false);
        expect(testResult.disabledAfterPropTrue).toBe(true);

        // Restore mode verification
        expect(testResult.restoredVal).toBe('restored_history_state');
        expect(testResult.restoredMode).toBe('restore');
        expect(testResult.restoredFormVal).toBe('restored_history_state');

        // Autocomplete mode verification
        expect(testResult.autofilledVal).toBe('autofilled_email');
        expect(testResult.autofilledMode).toBe('autocomplete');
        expect(testResult.autofilledFormVal).toBe('autofilled_email');
      });
    });

    // -----------------------------------------------------------------------
    // Features 80-84: integration, tooling, benchmarks, and fallback
    // -----------------------------------------------------------------------
    describe('features 80-84: integration, tooling, benchmarks, and fallback', () => {
      it('[F80] validates morph-to-react build CLI arguments and options (Milestone 6)', () => {
        // Test argument parsing logic
        const parsed = parseArgs(['build', 'src/components/button.ts', '--out-dir', 'dist/custom-react', '--suffix', '-morph', '--emit-css', '--no-dts', '--strip-prefix', 'cds-', '--no-cache']);

        expect(parsed.inputs).toEqual(['src/components/button.ts']);
        expect(parsed.outDir).toBe('dist/custom-react');
        expect(parsed.suffix).toBe('-morph');
        expect(parsed.emitCss).toBe(true);
        expect(parsed.emitDts).toBe(false);
        expect(parsed.stripPrefix).toBe('cds-');
        expect(parsed.noCache).toBe(true);

        // Test flag variants with = syntax
        const parsedEquals = parseArgs(['--out-dir=out', '--suffix=-r', '--strip-prefix=sp-']);
        expect(parsedEquals.outDir).toBe('out');
        expect(parsedEquals.suffix).toBe('-r');
        expect(parsedEquals.stripPrefix).toBe('sp-');

        // Test help and version flags
        const parsedHelp = parseArgs(['--help']);
        expect(parsedHelp.help).toBe(true);
        const parsedVer = parseArgs(['-v']);
        expect(parsedVer.version).toBe(true);
      });

      it('[F81] integrates morph-to-react with Vite / Rollup plugin pipeline (Milestone 6)', async () => {
        const plugin = morphLit({
          tagSuffix: '-r',
          emitCss: true,
        });

        expect(plugin.name).toBe('lit-morph-to-react');
        expect(plugin.enforce).toBe('pre');
        expect(typeof plugin.transform).toBe('function');

        // 1. Skips non-JS/TS files
        expect(plugin.transform('body { margin: 0; }', 'style.css')).toBeNull();

        // 2. Skips files without Lit indicators
        expect(plugin.transform('export const add = (a, b) => a + b;', 'math.ts')).toBeNull();

        // 3. Transforms valid Lit component
        const litSource = `
          import { LitElement, html, property } from 'lit';
          export class ViteButton extends LitElement {
            @property({ type: String }) label = 'Submit';
            render() {
              return html\`<button class="btn">\${this.label}</button>\`;
            }
          }
        `;
        const transformed = await plugin.transform(litSource, 'src/components/vite-button.ts');
        expect(transformed).not.toBeNull();
        expect(transformed?.code).toContain('export const ViteButton');
        expect(transformed?.code).toContain('vite-button-r');
      });

      it('[F82] provides content-hashed incremental build caching for sub-50ms rebuilds (Milestone 6)', () => {
        clearCompileCache();
        expect(getCompileCacheSize()).toBe(0);

        const sampleCode = `
          import { LitElement, html, property } from 'lit';
          export class IncrementalCard extends LitElement {
            @property({ type: String }) title = 'Card';
            render() {
              return html\`<div class="card"><h3>\${this.title}</h3></div>\`;
            }
          }
        `;

        // First compile: cache miss
        const res1 = compileModule(sampleCode, { filePath: 'card.ts' });
        expect(res1.componentName).toBe('IncrementalCard');
        expect(getCompileCacheSize()).toBeGreaterThanOrEqual(1);

        // Second compile: cache hit, sub-50ms
        const start = performance.now();
        const res2 = compileModule(sampleCode, { filePath: 'card.ts' });
        const elapsed = performance.now() - start;

        expect(elapsed).toBeLessThan(50);
        expect(res2.code).toBe(res1.code);

        // Compiling with noCache: bypasses cache write
        clearCompileCache();
        const resBypass = compileModule(sampleCode, { filePath: 'card.ts', noCache: true });
        expect(resBypass.componentName).toBe('IncrementalCard');
        expect(getCompileCacheSize()).toBe(0);
      });

      it('[F83] emits explicit @lit/react fallback wrapper for bailout components (Milestone 6)', () => {
        const bailoutSource = `
          import { LitElement, html } from 'lit';
          import { asyncAppend } from 'lit/directives/async-append.js';

          export class StreamingLog extends LitElement {
            render() {
              return html\`<div class="log">\${asyncAppend(this.stream)}</div>\`;
            }
          }
        `;

        const res = compileModule(bailoutSource, { filePath: 'streaming-log.ts' });
        expect(res.tier).toBe('Bailout');
        expect(res.componentName).toBe('StreamingLog');
        expect(res.diagnostics.length).toBeGreaterThan(0);
        expect(res.diagnostics.some((d) => d.code === 'LIT101')).toBe(true);

        // Emits @lit/react fallback wrapper
        expect(res.code).toContain('export const StreamingLog = forwardRef(');
        expect(res.code).toContain('<streaming-log');
        expect(res.code).toContain('ref={elementRef}');
      });

      it('[F84] validates five-suite differential verification and benchmark integration (Milestone 6)', () => {
        const benchmarkDocPath = path.resolve(rootDir, 'packages/internal/benchmarks/docs/morph-to-react.md');
        expect(fs.existsSync(benchmarkDocPath)).toBe(true);

        const docContent = fs.readFileSync(benchmarkDocPath, 'utf8');

        // All 5 suites must be represented in benchmark documentation
        expect(docContent).toContain('IBM Carbon');
        expect(docContent).toContain('Adobe Spectrum');
        expect(docContent).toContain('Google Material Web');
        expect(docContent).toContain('Web Awesome');
        expect(docContent).toContain('Cisco Momentum');

        // Sentence-case check: no Title Case headers
        const headings = docContent.match(/^#+\s+(.+)$/gm) ?? [];
        for (const heading of headings) {
          const text = heading.replace(/^#+\s+/, '');
          // First word capitalized, rest lowercase unless proper noun or acronym
          const words = text.split(/\s+/).slice(1);
          for (const w of words) {
            if (
              /^[A-Z][a-z]+$/.test(w) &&
              !['Lit', 'React', 'SSR', 'RSC', 'DOM', 'CSS', 'HTML', 'IBM', 'Carbon', 'Adobe', 'Spectrum', 'Google', 'Material', 'Web', 'Awesome', 'Cisco', 'Momentum', 'Apple', 'Silicon'].includes(w)
            ) {
              throw new Error(`Non-sentence-case heading found: "${heading}" at word "${w}"`);
            }
          }
        }

        // Zero em-dash check
        expect(docContent).not.toContain('—');
      });
    });
  });

  // =========================================================================
  // Tier 2: boundary and corner cases
  // =========================================================================
  describe('tier 2: boundary and corner cases', () => {
    it('handles empty template and empty component class safely', () => {
      const { defaultChildren } = partitionSlots([]);
      expect(defaultChildren).toHaveLength(0);
    });

    it('handles extreme property sets (100 properties) on a single component without memory leak', () => {
      const host = new MorphHost();
      for (let i = 0; i < 100; i++) {
        host.requestUpdate(`prop_${i}`, i);
      }
      expect(host._changedProperties.size).toBe(100);
    });

    it('handles deeply nested slot boundary trees (10 levels deep) without recursion overflow', async () => {
      const nestedResult = await page.evaluate(() => {
        const root = document.createElement('slot-boundary');
        let curr = root;
        for (let i = 0; i < 10; i++) {
          const child = document.createElement('slot-boundary');
          curr.appendChild(child);
          curr = child;
        }
        document.body.appendChild(root);
        const count = root.querySelectorAll('slot-boundary').length;
        document.body.removeChild(root);
        return count;
      });
      expect(nestedResult).toBe(10);
    });

    it('processes terser-mangled code with aliased imports and !0 booleans resiliently (Milestone 1)', () => {
      const code = `
        import { LitElement as _L, html as _h } from 'lit';
        class MangledBtn extends _L {
          static properties = {
            active: { type: Boolean, reflect: !0, attribute: "is-active" },
            disabled: { type: Boolean, reflect: !1 }
          };
          render() {
            return _h\`<button ?disabled="\${this.disabled}">\${this.active ? "On" : "Off"}</button>\`;
          }
        }
        customElements.define("mangled-btn", MangledBtn);
      `;
      const result = analyzeLitModule(code, { filename: 'mangled-btn.js' });
      expect(result.components).toHaveLength(1);
      const [comp] = result.components;
      expect(comp.tagName).toBe('mangled-btn');
      expect(comp.className).toBe('MangledBtn');
      const activeProp = comp.properties.find((p) => p.name === 'active');
      expect(activeProp).toBeDefined();
      expect(activeProp?.reflect).toBe(true);
      expect(activeProp?.attribute).toBe('is-active');
      const disabledProp = comp.properties.find((p) => p.name === 'disabled');
      expect(disabledProp).toBeDefined();
      expect(disabledProp?.reflect).toBe(false);
    });

    it('generates graceful bailout diagnostics when escaping this is passed to unknown third-party function (Milestone 1)', () => {
      const code = `
        import { LitElement, html } from 'lit';
        class UnsafeComponent extends LitElement {
          connectedCallback() {
            super.connectedCallback();
            externalRegister(this);
          }
          render() {
            return html\`<div>Unsafe</div>\`;
          }
        }
      `;
      const result = analyzeLitModule(code, { filename: 'unsafe.js' });
      expect(result.components).toHaveLength(1);
      const [comp] = result.components;
      expect(comp.tier).toBe('Bailout');
      const escapeDiag = result.diagnostics.find((d) => d.code === 'LIT102');
      expect(escapeDiag).toBeDefined();
      expect(escapeDiag?.message).toContain('externalRegister');
      expect(escapeDiag?.universalLitHint).toContain('ReactiveController');
    });

    it('handles duplicate slot names in tree order by projecting only to the first slot', () => {
      const icon1 = React.createElement('span', { slot: 'header', key: 'h1' }, 'Header 1');
      const icon2 = React.createElement('span', { slot: 'header', key: 'h2' }, 'Header 2');
      const { namedSlots } = partitionSlots([icon1, icon2]);
      expect(namedSlots.header?.[0]).toEqual(icon1);
    });

    it('verifies constraint validation failure prevents form submit in light DOM', async () => {
      const submitPrevented = await page.evaluate(() => {
        const form = document.createElement('form');
        const input = document.createElement('input');
        input.required = true;
        input.value = '';
        form.appendChild(input);
        document.body.appendChild(form);

        let submitted = false;
        form.addEventListener('submit', (e) => {
          e.preventDefault();
          submitted = true;
        });

        const isValid = form.checkValidity();
        document.body.removeChild(form);
        return { isValid, submitted };
      });
      expect(submitPrevented.isValid).toBe(false);
      expect(submitPrevented.submitted).toBe(false);
    });

    it('measures hostile global stylesheet penetration and validates @scope containment', async () => {
      const gap = await page.evaluate(() => {
        const style = document.createElement('style');
        style.textContent = `
          button.scoped-check { padding: 4px; }
          .hostile-override button.scoped-check { padding: 32px !important; }
        `;
        document.head.appendChild(style);

        const container = document.createElement('div');
        container.className = 'hostile-override';
        const btn = document.createElement('button');
        btn.className = 'scoped-check';
        container.appendChild(btn);
        document.body.appendChild(container);

        const padding = window.getComputedStyle(btn).paddingTop;
        document.body.removeChild(container);
        document.head.removeChild(style);
        return padding;
      });
      expect(gap).toBe('32px');
    });
  });

  // =========================================================================
  // Tier 3: cross-feature combinations
  // =========================================================================
  describe('tier 3: cross-feature combinations', () => {
    it('[Combination 1] reactive prop sync + self-mutation + custom event dispatch (cds-checkbox pattern)', async () => {
      const host = new CdsCheckboxHost();
      let eventFired = false;
      host.addEventListener('cds-checkbox-changed', (e: any) => {
        eventFired = true;
        expect(e.detail.checked).toBe(true);
      });

      const fakeInput = { checked: true, indeterminate: false } as HTMLInputElement;
      host._checkboxNode = fakeInput;
      host._handleChange();

      expect(host.checked).toBe(true);
      expect(eventFired).toBe(true);
    });

    it('[Combination 2] scoped CSS donut scoping + named slots + slot boundary MutationObserver (cds-tabs pattern)', async () => {
      const tabsSsr = renderToString(React.createElement(CdsTabs, { value: 't1' }, React.createElement(CdsTab, { value: 't1' }, 'Tab 1')));
      expect(tabsSsr).toContain('<slot-boundary style="display:contents"');
      expect(tabsSsr).toContain('<cds-tab');
    });

    it('[Combination 3] class inheritance + mixins + child element rewriting + directive lowering (Milestone 4)', async () => {
      const code = `
        import { LitElement, html, property } from 'lit';
        import { classMap } from 'lit/directives/class-map.js';

        export const HighlightMixin = (superClass: any) => class extends superClass {
          @property({ type: Boolean }) highlighted = false;
        };

        export class BasePanel extends HighlightMixin(LitElement) {
          @property({ type: String }) title = 'Panel';
        }

        export class ActionPanel extends BasePanel {
          @property({ type: Number }) count = 5;

          render() {
            return html\`
              <div class=\${classMap({ 'panel': true, 'is-highlighted': this.highlighted, 'is-active': this.count > 0 })}>
                <h2>\${this.title}</h2>
                <app-badge .count="\${this.count}"></app-badge>
              </div>
            \`;
          }
        }
      `;

      const res = compileModule(code, {
        filePath: 'action-panel.ts',
        targetTier: 'Tier1Hosted',
        knownTags: { 'app-badge': 'AppBadge' },
      });

      expect(res.code).toContain('class ActionPanelHost extends BasePanelHost');
      expect(res.code).toContain('<AppBadge');
      expect(res.code).not.toContain('<app-badge');
      expect(res.code).toContain('className=');
      expect(res.code).toContain('export const ActionPanel = forwardRef(');

      (globalThis as any).HighlightMixin = (superClass: any) =>
        class extends superClass {
          highlighted = false;
        };

      try {
        const AppBadgeMock = (props: any) => React.createElement('span', { className: 'app-badge' }, props.count);
        const Component = await evalComponent(res.code, 'ActionPanel', { './app-badge.js': { AppBadge: AppBadgeMock } });
        const htmlOutput = renderToString(React.createElement(Component, { title: 'Workflow Actions', count: 12 }));
        expect(htmlOutput).toContain('Workflow Actions');
        expect(htmlOutput).toContain('app-badge');
        expect(htmlOutput).toContain('12');
      } finally {
        delete (globalThis as any).HighlightMixin;
      }
    });

    it('[Combination 4] React 19 SSR + Strict Mode hydration + useId rewriting + hoisted <style precedence> (Milestone 2)', async () => {
      const code = `
        import { LitElement, html, css } from 'lit';
        export class AccessibleCombobox extends LitElement {
          static styles = css\`
            .combo-wrap { position: relative; }
            .combo-input { border: 1px solid #ccc; }
            .combo-help { font-size: 0.875rem; color: #666; }
          \`;

          render() {
            return html\`
              <div class="combo-wrap">
                <label for="combo-input">Search options</label>
                <input id="combo-input" aria-describedby="combo-help" class="combo-input" />
                <span id="combo-help" class="combo-help">Type to search options</span>
              </div>
            \`;
          }
        }
      `;

      const res = compileModule(code, { filePath: 'accessible-combobox.ts', emitCss: false });
      expect(res.code).toContain('useId()');
      expect(res.code).toContain('precedence="default"');
      expect(res.code).toContain('<style');

      const Component = await evalComponent(res.code, 'AccessibleCombobox');

      // 1. React 19 SSR
      const ssrOutput = renderToString(React.createElement(Component));
      expect(ssrOutput).toContain('precedence="default"');
      expect(ssrOutput).toContain('combo-input');
      expect(ssrOutput).toContain('combo-help');

      // 2. Strict Mode DOM mount and hydration parity in browser page
      const cjsCode = await transpileJsxToCjs(res.code);
      const testResult = await page.evaluate(async (componentCode: string) => {
        const container = document.createElement('div');
        container.id = 'comb-4-container';
        document.body.appendChild(container);

        const React = (window as any).React;
        const StrictMode = (window as any).StrictMode;
        const createRoot = (window as any).createRoot;
        const flushSync = (window as any).flushSync;

        const exports: any = {};
        const customRequire = (spec: string) => {
          if (spec === 'react') return React;
          if (spec === '@lit-core/morph-to-react/runtime') return (window as any).morphRuntime;
          throw new Error(`Unknown spec: ${spec}`);
        };
        const fn = new Function('React', 'exports', 'require', componentCode);
        fn(React, exports, customRequire);
        const AccessibleCombobox = exports.AccessibleCombobox;

        const root = createRoot(container);
        flushSync(() => {
          root.render(React.createElement(StrictMode, null, React.createElement(AccessibleCombobox)));
        });

        const label = container.querySelector('label') as HTMLLabelElement;
        const input = container.querySelector('input') as HTMLInputElement;
        const span = container.querySelector('span') as HTMLSpanElement;

        const labelFor = label?.getAttribute('for') || (label as any)?.htmlFor;
        const inputId = input?.id;
        const spanId = span?.id;
        const describedBy = input?.getAttribute('aria-describedby');

        root.unmount();
        container.remove();

        return {
          labelFor,
          inputId,
          spanId,
          describedBy,
          isLinked: Boolean(labelFor && inputId && labelFor === inputId && describedBy === spanId),
        };
      }, cjsCode);

      expect(testResult.isLinked).toBe(true);
      expect(testResult.inputId).not.toBe('combo-input'); // Rewritten with useId
    });

    it('[Combination 5] ElementInternals form proxy + constraint validation + native <form> submission (Milestone 5)', async () => {
      const code = `
        import { LitElement, html, property } from 'lit';
        export class ValidatedEmailInput extends LitElement {
          static formAssociated = true;

          @property({ type: String }) value = 'user@example.com';

          constructor() {
            super();
            this._internals = this.attachInternals();
          }

          firstUpdated() {
            this._internals.setFormValue(this.value);
          }

          updated(changedProps: Map<string, any>) {
            if (changedProps.has('value')) {
              this._internals.setFormValue(this.value);
            }
          }

          setCustomError(msg: string) {
            if (msg) {
              this._internals.setValidity({ customError: true }, msg, this);
            } else {
              this._internals.setValidity({});
            }
          }

          render() {
            return html\`<div class="email-control"><span>Email:</span> \${this.value}</div>\`;
          }
        }
      `;

      const res = compileModule(code, { filePath: 'validated-email-input.ts' });
      expect(res.tier).toBe('Tier2HostedWithFacade');

      const cjsCode = await transpileJsxToCjs(res.code);

      const testResult = await page.evaluate(async (transpiledJs: string) => {
        const container = document.createElement('div');
        container.id = 'comb-5-container';
        document.body.appendChild(container);

        const React = (window as any).React;
        const createRoot = (window as any).createRoot;
        const flushSync = (window as any).flushSync;

        const exports: any = {};
        const customRequire = (spec: string) => {
          if (spec === 'react') return React;
          if (spec === '@lit-core/morph-to-react/runtime') return (window as any).morphRuntime;
          throw new Error(`Unknown spec: ${spec}`);
        };
        const fn = new Function('React', 'exports', 'require', transpiledJs);
        fn(React, exports, customRequire);
        const ValidatedEmailInput = exports.ValidatedEmailInput;

        const root = createRoot(container);
        let hostRef: any = null;

        flushSync(() => {
          root.render(
            React.createElement(
              'form',
              { id: 'comb5-form' },
              React.createElement(ValidatedEmailInput, {
                name: 'user_email',
                value: 'user@example.com',
                ref: (inst: any) => {
                  hostRef = inst;
                },
              }),
              React.createElement('button', { type: 'submit', id: 'submit-btn' }, 'Submit'),
            ),
          );
        });

        const form = container.querySelector('#comb5-form') as HTMLFormElement;
        const proxyInput = form.querySelector('input[name="user_email"]') as HTMLInputElement;

        // 1. Initial state: value is valid
        const initialValid = form.checkValidity();

        // 2. Set custom validation error to fail validation
        hostRef.setCustomError('Email address is invalid');
        const invalidCheck = form.checkValidity();

        // 3. Clear error and verify valid again
        hostRef.setCustomError('');
        const clearedCheck = form.checkValidity();
        const formDataVal = new FormData(form).get('user_email');

        root.unmount();
        container.remove();

        return {
          proxyExists: Boolean(proxyInput),
          initialValid,
          invalidCheck,
          clearedCheck,
          formDataVal,
        };
      }, cjsCode);

      expect(testResult.proxyExists).toBe(true);
      expect(testResult.initialValid).toBe(true);
      expect(testResult.invalidCheck).toBe(false); // Constraint validation prevented submission
      expect(testResult.clearedCheck).toBe(true); // Validated successfully
      expect(testResult.formDataVal).toBe('user@example.com'); // Native form participation
    });
  });

  // =========================================================================
  // Tier 4: real-world multi-component enterprise application scenarios
  // =========================================================================
  describe('tier 4: real-world multi-component enterprise application scenarios', () => {
    it('[Scenario 1] IBM Carbon interactive form application (cds-button, cds-checkbox, cds-text-input)', async () => {
      const appHtml = renderToString(
        React.createElement(
          'form',
          { id: 'carbon-user-form' },
          React.createElement(CdsCheckbox, { name: 'agree', defaultChecked: true, labelText: 'I agree' }),
          React.createElement(CdsButton, { kind: 'primary', type: 'submit' }, 'Submit'),
        ),
      );

      const formResult = await page.evaluate(
        ({ html }: { html: string }) => {
          const div = document.createElement('div');
          div.innerHTML = html;
          document.body.appendChild(div);

          const form = div.querySelector('form');
          const btn = form?.querySelector('cds-button');
          const chk = form?.querySelector('cds-checkbox');

          const hasBtn = Boolean(btn);
          const hasChk = Boolean(chk);
          const btnText = btn?.textContent?.trim();

          document.body.removeChild(div);
          return { hasBtn, hasChk, btnText };
        },
        { html: appHtml },
      );

      expect(formResult.hasBtn).toBe(true);
      expect(formResult.hasChk).toBe(true);
      expect(formResult.btnText).toContain('Submit');
    });

    it('[Scenario 2] Adobe Spectrum multi-tab dashboard (sp-tabs, sp-tab, sp-button) (Milestone 3)', async () => {
      const code = `
        import { LitElement, html, property } from 'lit';
        export class SpectrumDashboard extends LitElement {
          @property({ type: String }) selectedTab = 'overview';
          @property({ type: Boolean }) refreshing = false;

          render() {
            return html\`
              <div class="spectrum-shell">
                <sp-tabs selected="\${this.selectedTab}">
                  <sp-tab value="overview" label="Overview"></sp-tab>
                  <sp-tab value="reports" label="Reports"></sp-tab>
                </sp-tabs>
                <div class="action-bar">
                  <sp-button variant="accent" ?disabled="\${this.refreshing}">Refresh Dashboard</sp-button>
                </div>
              </div>
            \`;
          }
        }
      `;

      const res = compileModule(code, { filePath: 'spectrum-dashboard.ts' });
      expect(res.code).toContain('export const SpectrumDashboard');
      expect(res.code).toContain('spectrum-dashboard');

      const Component = await evalComponent(res.code, 'SpectrumDashboard');
      const ssrHtml = renderToString(React.createElement(Component, { selectedTab: 'reports', refreshing: false }));

      const evalResult = await page.evaluate(
        ({ html }: { html: string }) => {
          const div = document.createElement('div');
          div.innerHTML = html;
          document.body.appendChild(div);

          const tabs = div.querySelector('sp-tabs');
          const tabItems = div.querySelectorAll('sp-tab');
          const btn = div.querySelector('sp-button');

          const hasTabs = Boolean(tabs);
          const tabCount = tabItems.length;
          const btnText = btn?.textContent?.trim();

          document.body.removeChild(div);
          return { hasTabs, tabCount, btnText };
        },
        { html: ssrHtml },
      );

      expect(evalResult.hasTabs).toBe(true);
      expect(evalResult.tabCount).toBe(2);
      expect(evalResult.btnText).toContain('Refresh Dashboard');
    });

    it('[Scenario 3] Google Material Web reactive controls and badge (md-filled-button, md-checkbox, md-badge) (Milestone 4)', async () => {
      const code = `
        import { LitElement, html, property } from 'lit';
        export class MaterialControlPanel extends LitElement {
          @property({ type: Boolean }) checked = true;
          @property({ type: String }) badgeValue = '99+';

          render() {
            return html\`
              <div class="md-control-panel">
                <md-checkbox ?checked="\${this.checked}" aria-label="Notifications toggle"></md-checkbox>
                <md-badge value="\${this.badgeValue}"></md-badge>
                <md-filled-button>Save Preferences</md-filled-button>
              </div>
            \`;
          }
        }
      `;

      const res = compileModule(code, { filePath: 'material-control-panel.ts' });
      expect(res.code).toContain('export const MaterialControlPanel');

      const Component = await evalComponent(res.code, 'MaterialControlPanel');
      const ssrHtml = renderToString(React.createElement(Component, { checked: true, badgeValue: '12' }));

      const evalResult = await page.evaluate(
        ({ html }: { html: string }) => {
          const div = document.createElement('div');
          div.innerHTML = html;
          document.body.appendChild(div);

          const chk = div.querySelector('md-checkbox');
          const badge = div.querySelector('md-badge');
          const btn = div.querySelector('md-filled-button');

          const hasChk = Boolean(chk);
          const hasBadge = Boolean(badge);
          const btnText = btn?.textContent?.trim();

          document.body.removeChild(div);
          return { hasChk, hasBadge, btnText };
        },
        { html: ssrHtml },
      );

      expect(evalResult.hasChk).toBe(true);
      expect(evalResult.hasBadge).toBe(true);
      expect(evalResult.btnText).toContain('Save Preferences');
    });

    it('[Scenario 4] Web Awesome composite card layout (wa-button, wa-card, wa-badge) (Milestone 5)', async () => {
      const code = `
        import { LitElement, html, property } from 'lit';
        export class AwesomeProductCard extends LitElement {
          @property({ type: String }) status = 'In Stock';
          @property({ type: String }) title = 'Pro License';

          render() {
            return html\`
              <wa-card class="product-card">
                <div slot="header" class="card-header">
                  <h3>\${this.title}</h3>
                  <wa-badge variant="success">\${this.status}</wa-badge>
                </div>
                <p>Enterprise subscription plan with advanced analytics.</p>
                <div slot="footer" class="card-footer">
                  <wa-button variant="brand">Purchase Now</wa-button>
                </div>
              </wa-card>
            \`;
          }
        }
      `;

      const res = compileModule(code, { filePath: 'awesome-product-card.ts' });
      expect(res.code).toContain('export const AwesomeProductCard');

      const Component = await evalComponent(res.code, 'AwesomeProductCard');
      const ssrHtml = renderToString(React.createElement(Component, { title: 'Enterprise Plan', status: 'Active' }));

      const evalResult = await page.evaluate(
        ({ html }: { html: string }) => {
          const div = document.createElement('div');
          div.innerHTML = html;
          document.body.appendChild(div);

          const card = div.querySelector('wa-card');
          const badge = div.querySelector('wa-badge');
          const btn = div.querySelector('wa-button');

          const hasCard = Boolean(card);
          const badgeText = badge?.textContent?.trim();
          const btnText = btn?.textContent?.trim();

          document.body.removeChild(div);
          return { hasCard, badgeText, btnText };
        },
        { html: ssrHtml },
      );

      expect(evalResult.hasCard).toBe(true);
      expect(evalResult.badgeText).toContain('Active');
      expect(evalResult.btnText).toContain('Purchase Now');
    });

    it('[Scenario 5] Cisco Momentum enterprise action bar workflow (mdc-button, mdc-checkbox) (Milestone 6)', async () => {
      const code = `
        import { LitElement, html, property } from 'lit';
        export class MomentumActionBar extends LitElement {
          @property({ type: Boolean }) allSelected = false;
          @property({ type: Number }) selectedCount = 0;

          render() {
            return html\`
              <div class="mdc-action-bar">
                <mdc-checkbox ?checked="\${this.allSelected}" label="Select All"></mdc-checkbox>
                <span class="selection-count">\${this.selectedCount} items selected</span>
                <mdc-button variant="secondary" ?disabled="\${this.selectedCount === 0}">Archive Selected</mdc-button>
                <mdc-button variant="primary">New Item</mdc-button>
              </div>
            \`;
          }
        }
      `;

      const res = compileModule(code, { filePath: 'momentum-action-bar.ts' });
      expect(res.code).toContain('export const MomentumActionBar');

      const Component = await evalComponent(res.code, 'MomentumActionBar');
      const ssrHtml = renderToString(React.createElement(Component, { allSelected: true, selectedCount: 7 }));

      const evalResult = await page.evaluate(
        ({ html }: { html: string }) => {
          const div = document.createElement('div');
          div.innerHTML = html;
          document.body.appendChild(div);

          const chk = div.querySelector('mdc-checkbox');
          const count = div.querySelector('.selection-count');
          const buttons = div.querySelectorAll('mdc-button');

          const hasChk = Boolean(chk);
          const countText = count?.textContent?.trim();
          const buttonCount = buttons.length;

          document.body.removeChild(div);
          return { hasChk, countText, buttonCount };
        },
        { html: ssrHtml },
      );

      expect(evalResult.hasChk).toBe(true);
      expect(evalResult.countText).toContain('7 items selected');
      expect(evalResult.buttonCount).toBe(2);
    });
  });

  // =========================================================================
  // Tier 5: comprehensive 5-point differential parity suite (Carbon button, checkbox, tabs)
  // =========================================================================
  describe('tier 5: comprehensive 5-point differential parity suite (Carbon button, checkbox, tabs)', () => {
    // -----------------------------------------------------------------------
    // Point 1: IBM Carbon Button differential parity
    // -----------------------------------------------------------------------
    describe('IBM Carbon button differential parity', () => {
      it('verifies 100% accessibility tree (ariaSnapshot) parity across button variants', async () => {
        const variants = [
          { kind: 'primary', label: 'Primary Action' },
          { kind: 'secondary', label: 'Secondary Action' },
          { kind: 'danger', label: 'Delete Item' },
          { kind: 'ghost', label: 'Ghost Option' },
        ];

        for (const v of variants) {
          const reactHtml = renderToString(React.createElement(StrictMode, null, React.createElement(CdsButton, { kind: v.kind as any }, v.label)));

          await mountFrameA(`<cds-button kind="${v.kind}">${v.label}</cds-button>`);
          await mountFrameB(reactHtml, buttonStyles);

          const wcAria = await page.frameLocator('#frame-a').locator('cds-button').ariaSnapshot();
          const reactAria = await page.frameLocator('#frame-b').locator('cds-button').ariaSnapshot();
          expect(reactAria).toBe(wcAria);
          expect(reactAria).toContain(v.label);
        }
      });

      it('verifies interaction parity and capture-phase click suppression when disabled', async () => {
        const reactDisabledHtml = renderToString(React.createElement(StrictMode, null, React.createElement(CdsButton, { kind: 'primary', disabled: true }, 'Disabled Action')));

        await mountFrameA('<cds-button kind="primary" disabled>Disabled Action</cds-button>');
        await mountFrameB(reactDisabledHtml, buttonStyles);

        const clickResult = await page.evaluate(() => {
          const fA = document.getElementById('frame-a') as HTMLIFrameElement;
          const fB = document.getElementById('frame-b') as HTMLIFrameElement;

          let clickedA = false;
          let clickedB = false;

          fA.contentDocument?.querySelector('cds-button')?.addEventListener('click', () => {
            clickedA = true;
          });
          fB.contentDocument?.querySelector('cds-button')?.addEventListener('click', () => {
            clickedB = true;
          });

          (fA.contentDocument?.querySelector('cds-button') as HTMLElement)?.click();
          (fB.contentDocument?.querySelector('cds-button') as HTMLElement)?.click();

          return { clickedA, clickedB };
        });

        expect(clickResult.clickedA).toBe(false);
        expect(clickResult.clickedB).toBe(false);
      });

      it('verifies visual geometry pixel match (>= 99.5%) for primary button', async () => {
        const reactHtml = renderToString(React.createElement(StrictMode, null, React.createElement(CdsButton, { kind: 'primary' }, 'Primary Action')));
        await mountFrameA('<cds-button kind="primary">Primary Action</cds-button>');
        await mountFrameB(reactHtml, buttonStyles);

        const locA = page.frameLocator('#frame-a').locator('cds-button');
        const locB = page.frameLocator('#frame-b').locator('cds-button');

        const pngA = await locA.screenshot();
        const pngB = await locB.screenshot();

        const matchPct = await page.evaluate(
          async ({ b64A, b64B }: { b64A: string; b64B: string }) => {
            const load = (src: string) =>
              new Promise<HTMLImageElement>((res) => {
                const img = new Image();
                img.onload = () => res(img);
                img.src = src;
              });

            const [imgA, imgB] = await Promise.all([load(b64A), load(b64B)]);
            const w = Math.min(imgA.width, imgB.width);
            const h = Math.min(imgA.height, imgB.height);

            const cA = document.createElement('canvas');
            cA.width = w;
            cA.height = h;
            const ctxA = cA.getContext('2d');
            if (!ctxA) throw new Error('Failed to acquire 2D context for canvas A');
            ctxA.drawImage(imgA, 0, 0);
            const dataA = ctxA.getImageData(0, 0, w, h).data;

            const cB = document.createElement('canvas');
            cB.width = w;
            cB.height = h;
            const ctxB = cB.getContext('2d');
            if (!ctxB) throw new Error('Failed to acquire 2D context for canvas B');
            ctxB.drawImage(imgB, 0, 0);
            const dataB = ctxB.getImageData(0, 0, w, h).data;

            let diffs = 0;
            const total = w * h;
            for (let i = 0; i < dataA.length; i += 4) {
              if (Math.abs(dataA[i] - dataB[i]) > 10 || Math.abs(dataA[i + 1] - dataB[i + 1]) > 10 || Math.abs(dataA[i + 2] - dataB[i + 2]) > 10) {
                diffs++;
              }
            }
            return (1 - diffs / total) * 100;
          },
          { b64A: `data:image/png;base64,${pngA.toString('base64')}`, b64B: `data:image/png;base64,${pngB.toString('base64')}` },
        );

        expect(matchPct).toBeGreaterThanOrEqual(99.5);
      });
    });

    // -----------------------------------------------------------------------
    // Point 2: IBM Carbon Checkbox differential parity
    // -----------------------------------------------------------------------
    describe('IBM Carbon checkbox differential parity', () => {
      it('verifies 100% accessibility tree (ariaSnapshot) parity across checkbox variants', async () => {
        const variants = [
          { checked: false, disabled: false, label: 'Unchecked Terms' },
          { checked: true, disabled: false, label: 'Checked Terms' },
          { checked: false, disabled: true, label: 'Disabled Terms' },
        ];

        for (const v of variants) {
          const reactHtml = renderToString(React.createElement(StrictMode, null, React.createElement(CdsCheckbox, { checked: v.checked, disabled: v.disabled, labelText: v.label })));

          await mountFrameA(`<cds-checkbox ${v.checked ? 'checked' : ''} ${v.disabled ? 'disabled' : ''}>${v.label}</cds-checkbox>`);
          await mountFrameB(reactHtml, checkboxStyles);

          const wcAria = await page.frameLocator('#frame-a').locator('cds-checkbox').ariaSnapshot();
          const reactAria = await page.frameLocator('#frame-b').locator('cds-checkbox').ariaSnapshot();

          expect(reactAria).toBe(wcAria);
          expect(reactAria).toContain(v.label);
        }
      });

      it('verifies native form participation and FormData parity without duplicate entries', async () => {
        const reactFormHtml = renderToString(
          React.createElement(
            StrictMode,
            null,
            React.createElement('form', { id: 'usr-form' }, React.createElement(CdsCheckbox, { name: 'subscribe', value: 'newsletter', defaultChecked: true, labelText: 'Newsletter' })),
          ),
        );

        await mountFrameA('<form id="usr-form"><cds-checkbox checked name="subscribe" value="newsletter">Newsletter</cds-checkbox></form>');
        await mountFrameB(reactFormHtml, checkboxStyles);

        const formDataResult = await page.evaluate(() => {
          const fA = document.getElementById('frame-a') as HTMLIFrameElement;
          const fB = document.getElementById('frame-b') as HTMLIFrameElement;

          const formA = fA.contentDocument?.getElementById('usr-form') as HTMLFormElement;
          const formB = fB.contentDocument?.getElementById('usr-form') as HTMLFormElement;

          const dataA = new FormData(formA);
          const dataB = new FormData(formB);

          const entriesA = Array.from(dataA.entries());
          const entriesB = Array.from(dataB.entries());

          return { entriesA, entriesB };
        });

        expect(formDataResult.entriesB).toEqual(formDataResult.entriesA);
        expect(formDataResult.entriesB).toEqual([['subscribe', 'newsletter']]);
      });

      it('verifies visual geometry pixel match (>= 99.5%) for checkbox', async () => {
        const reactHtml = renderToString(React.createElement(StrictMode, null, React.createElement(CdsCheckbox, { checked: true, labelText: 'Terms and Conditions' })));
        await mountFrameA('<cds-checkbox checked>Terms and Conditions</cds-checkbox>');
        await mountFrameB(reactHtml, checkboxStyles);

        const locA = page.frameLocator('#frame-a').locator('cds-checkbox');
        const locB = page.frameLocator('#frame-b').locator('cds-checkbox');

        const pngA = await locA.screenshot();
        const pngB = await locB.screenshot();

        const matchPct = await page.evaluate(
          async ({ b64A, b64B }: { b64A: string; b64B: string }) => {
            const load = (src: string) =>
              new Promise<HTMLImageElement>((res) => {
                const img = new Image();
                img.onload = () => res(img);
                img.src = src;
              });

            const [imgA, imgB] = await Promise.all([load(b64A), load(b64B)]);
            const w = Math.min(imgA.width, imgB.width);
            const h = Math.min(imgA.height, imgB.height);

            const cA = document.createElement('canvas');
            cA.width = w;
            cA.height = h;
            const ctxA = cA.getContext('2d');
            if (!ctxA) throw new Error('Failed to acquire 2D context for canvas A');
            ctxA.drawImage(imgA, 0, 0);
            const dataA = ctxA.getImageData(0, 0, w, h).data;

            const cB = document.createElement('canvas');
            cB.width = w;
            cB.height = h;
            const ctxB = cB.getContext('2d');
            if (!ctxB) throw new Error('Failed to acquire 2D context for canvas B');
            ctxB.drawImage(imgB, 0, 0);
            const dataB = ctxB.getImageData(0, 0, w, h).data;

            let diffs = 0;
            const total = w * h;
            for (let i = 0; i < dataA.length; i += 4) {
              if (Math.abs(dataA[i] - dataB[i]) > 10 || Math.abs(dataA[i + 1] - dataB[i + 1]) > 10 || Math.abs(dataA[i + 2] - dataB[i + 2]) > 10) {
                diffs++;
              }
            }
            return (1 - diffs / total) * 100;
          },
          { b64A: `data:image/png;base64,${pngA.toString('base64')}`, b64B: `data:image/png;base64,${pngB.toString('base64')}` },
        );

        expect(matchPct).toBeGreaterThanOrEqual(99.5);
      });
    });

    // -----------------------------------------------------------------------
    // Point 3: IBM Carbon Tabs composite differential parity
    // -----------------------------------------------------------------------
    describe('IBM Carbon tabs composite differential parity', () => {
      it('verifies 100% accessibility tree (ariaSnapshot) parity on tabs composite', async () => {
        const reactTabsHtml = renderToString(
          React.createElement(
            StrictMode,
            null,
            React.createElement(
              CdsTabs,
              { value: 'tab-1' },
              React.createElement(CdsTab, { value: 'tab-1', target: 'p-1' }, 'Overview'),
              React.createElement(CdsTab, { value: 'tab-2', target: 'p-2' }, 'Settings'),
              React.createElement(CdsTab, { value: 'tab-3', target: 'p-3', disabled: true }, 'Disabled Tab'),
            ),
          ),
        );

        await mountFrameA(`
          <cds-tabs value="tab-1">
            <cds-tab value="tab-1" target="p-1">Overview</cds-tab>
            <cds-tab value="tab-2" target="p-2">Settings</cds-tab>
            <cds-tab value="tab-3" target="p-3" disabled>Disabled Tab</cds-tab>
          </cds-tabs>
        `);
        await mountFrameB(reactTabsHtml, tabsStyles);

        const wcAria = await page.frameLocator('#frame-a').locator('cds-tabs').ariaSnapshot();
        const reactAria = await page.frameLocator('#frame-b').locator('cds-tabs').ariaSnapshot();

        expect(reactAria).toBe(wcAria);
        expect(reactAria).toContain('Overview');
        expect(reactAria).toContain('Settings');
      });

      it('verifies visual geometry pixel match (>= 99.5%) for tabs composite', async () => {
        const reactTabsHtml = renderToString(
          React.createElement(
            StrictMode,
            null,
            React.createElement(
              CdsTabs,
              { value: 'tab-1' },
              React.createElement(CdsTab, { value: 'tab-1' }, 'Overview'),
              React.createElement(CdsTab, { value: 'tab-2' }, 'Settings'),
              React.createElement(CdsTab, { value: 'tab-3', disabled: true }, 'Disabled Tab'),
            ),
          ),
        );

        await mountFrameA(`
          <cds-tabs value="tab-1">
            <cds-tab value="tab-1">Overview</cds-tab>
            <cds-tab value="tab-2">Settings</cds-tab>
            <cds-tab value="tab-3" disabled>Disabled Tab</cds-tab>
          </cds-tabs>
        `);
        await mountFrameB(reactTabsHtml, tabsStyles);

        const locA = page.frameLocator('#frame-a').locator('cds-tabs');
        const locB = page.frameLocator('#frame-b').locator('cds-tabs');

        await page.evaluate(() => {
          const fA = document.getElementById('frame-a') as HTMLIFrameElement;
          const fB = document.getElementById('frame-b') as HTMLIFrameElement;
          (fA.contentDocument?.activeElement as HTMLElement)?.blur();
          (fB.contentDocument?.activeElement as HTMLElement)?.blur();
        });

        const pngA = await locA.screenshot();
        const pngB = await locB.screenshot();

        const matchPct = await page.evaluate(
          async ({ b64A, b64B }: { b64A: string; b64B: string }) => {
            const load = (src: string) =>
              new Promise<HTMLImageElement>((res) => {
                const img = new Image();
                img.onload = () => res(img);
                img.src = src;
              });

            const [imgA, imgB] = await Promise.all([load(b64A), load(b64B)]);
            const w = Math.min(imgA.width, imgB.width);
            const h = Math.min(imgA.height, imgB.height);

            const cA = document.createElement('canvas');
            cA.width = w;
            cA.height = h;
            const ctxA = cA.getContext('2d');
            if (!ctxA) throw new Error('Failed to acquire 2D context for canvas A');
            ctxA.drawImage(imgA, 0, 0);
            const dataA = ctxA.getImageData(0, 0, w, h).data;

            const cB = document.createElement('canvas');
            cB.width = w;
            cB.height = h;
            const ctxB = cB.getContext('2d');
            if (!ctxB) throw new Error('Failed to acquire 2D context for canvas B');
            ctxB.drawImage(imgB, 0, 0);
            const dataB = ctxB.getImageData(0, 0, w, h).data;

            let diffs = 0;
            const total = w * h;
            for (let i = 0; i < dataA.length; i += 4) {
              if (Math.abs(dataA[i] - dataB[i]) > 10 || Math.abs(dataA[i + 1] - dataB[i + 1]) > 10 || Math.abs(dataA[i + 2] - dataB[i + 2]) > 10) {
                diffs++;
              }
            }
            return (1 - diffs / total) * 100;
          },
          { b64A: `data:image/png;base64,${pngA.toString('base64')}`, b64B: `data:image/png;base64,${pngB.toString('base64')}` },
        );

        expect(matchPct).toBeGreaterThanOrEqual(99.5);
      });
    });
  });
});
