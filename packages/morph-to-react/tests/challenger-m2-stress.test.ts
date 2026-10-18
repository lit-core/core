import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import React, { StrictMode } from 'react';
import { renderToString } from 'react-dom/server';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { analyzeLitModule, compileModule } from '../src/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../../..');

function evalComponent(code: string, componentName: string): React.ComponentType<any> {
  const trans = ts.transpileModule(code, {
    compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS },
  });
  const exports: any = {};
  const fn = new Function('React', 'exports', trans.outputText);
  fn(React, exports);
  return exports[componentName];
}

describe('Milestone 2 Challenger: Empirical AST and JSX Stress Testing', () => {
  // =========================================================================
  // 1. Deeply nested JSX hierarchies (5+ levels deep)
  // =========================================================================
  describe('1. Deeply nested JSX hierarchies', () => {
    it('lowers an 8-level deeply nested hierarchy with AST builder integrity', () => {
      const code = `
        import { LitElement, html } from 'lit';
        export class DeepHierarchy extends LitElement {
          render() {
            return html\`
              <div class="level-0">
                <section class="level-1">
                  <article class="level-2">
                    <main class="level-3">
                      <aside class="level-4">
                        <nav class="level-5">
                          <ul class="level-6">
                            <li class="level-7">
                              <span class="deep-leaf">Deepest Leaf Content</span>
                            </li>
                          </ul>
                        </nav>
                      </aside>
                    </main>
                  </article>
                </section>
              </div>
            \`;
          }
        }
      `;

      const res = compileModule(code, { filePath: 'deep-hierarchy.ts' });
      expect(res.tier).toBe('Tier0Pure');
      expect(res.componentName).toBe('DeepHierarchy');
      expect(res.code).toContain('export function DeepHierarchy(');

      // Verify AST tags preserved across all 8 levels
      expect(res.code).toContain('className="level-0"');
      expect(res.code).toContain('className="level-1"');
      expect(res.code).toContain('className="level-2"');
      expect(res.code).toContain('className="level-3"');
      expect(res.code).toContain('className="level-4"');
      expect(res.code).toContain('className="level-5"');
      expect(res.code).toContain('className="level-6"');
      expect(res.code).toContain('className="level-7"');
      expect(res.code).toContain('Deepest Leaf Content');

      // Verify parsed by oxc_parser
      const parsed = analyzeLitModule(res.code, { filename: 'deep-hierarchy.tsx' });
      expect(parsed).toBeDefined();

      // Verify execution in React SSR
      const Component = evalComponent(res.code, 'DeepHierarchy');
      const htmlOutput = renderToString(React.createElement(Component));
      expect(htmlOutput).toContain('class="level-0"');
      expect(htmlOutput).toContain('class="level-7"');
      expect(htmlOutput).toContain('Deepest Leaf Content');
    });

    it('lowers 6 levels of nesting with local variable expressions at multiple depths', () => {
      const code = `
        import { LitElement, html } from 'lit';
        export class NestedExpressions extends LitElement {
          render() {
            const variant = 'highlight';
            const title = 'Deep Analytics';
            const count = 99;
            return html\`
              <div class="card \${variant}">
                <header class="header">
                  <h2>\${title}</h2>
                </header>
                <section class="body">
                  <div class="inner-wrap">
                    <p class="summary">
                      Count: <strong>\${count}</strong>
                    </p>
                  </div>
                </section>
              </div>
            \`;
          }
        }
      `;

      const res = compileModule(code, { filePath: 'nested-expr.ts' });
      expect(res.tier).toBe('Tier0Pure');

      // Verify local variable expressions across all depths
      expect(res.code).toContain('const variant = "highlight";');
      expect(res.code).toContain('const title = "Deep Analytics";');
      expect(res.code).toContain('const count = 99;');
      expect(res.code).toContain('className={`card ${variant}`}');

      // Verify oxc_parser validity
      const parsed = analyzeLitModule(res.code, { filename: 'nested-expr.tsx' });
      expect(parsed).toBeDefined();

      // Verify React SSR execution
      const Component = evalComponent(res.code, 'NestedExpressions');
      const htmlOutput = renderToString(React.createElement(Component));
      expect(htmlOutput).toContain('class="card highlight"');
      expect(htmlOutput).toContain('<h2>Deep Analytics</h2>');
      expect(htmlOutput).toContain('<strong>99</strong>');
    });
  });

  // =========================================================================
  // 2. Full SVG camelCasing and namespace recovery
  // =========================================================================
  describe('2. Full SVG camelCasing and namespace recovery', () => {
    it('maps all standard kebab-case SVG attributes to camelCase JSX equivalents', () => {
      const code = `
        import { LitElement, html } from 'lit';
        export class FullSvgIcon extends LitElement {
          render() {
            return html\`
              <svg
                viewBox="0 0 100 100"
                stroke-width="2.5"
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-miterlimit="10"
                stroke-dasharray="4,4"
                stroke-dashoffset="2"
                stroke-opacity="0.85"
                fill-rule="nonzero"
                fill-opacity="0.75"
                clip-rule="evenodd"
                clip-path="url(#my-clip)"
                stop-color="#ff0055"
                stop-opacity="0.9"
                text-anchor="middle"
                dominant-baseline="central"
                alignment-baseline="middle"
                font-size="14px"
                font-family="sans-serif"
                font-weight="bold"
                letter-spacing="1px"
                word-spacing="2px"
                xlink:href="#glyph-1"
                xml:space="preserve"
                color-interpolation="sRGB"
                color-interpolation-filters="linearRGB"
              >
                <circle cx="50" cy="50" r="40" />
              </svg>
            \`;
          }
        }
      `;

      const res = compileModule(code, { filePath: 'full-svg.ts' });
      expect(res.tier).toBe('Tier0Pure');

      // Verify all mapped camelCase attributes
      expect(res.code).toContain('viewBox="0 0 100 100"');
      expect(res.code).toContain('strokeWidth="2.5"');
      expect(res.code).toContain('strokeLinecap="round"');
      expect(res.code).toContain('strokeLinejoin="round"');
      expect(res.code).toContain('strokeMiterlimit="10"');
      expect(res.code).toContain('strokeDasharray="4,4"');
      expect(res.code).toContain('strokeDashoffset="2"');
      expect(res.code).toContain('strokeOpacity="0.85"');
      expect(res.code).toContain('fillRule="nonzero"');
      expect(res.code).toContain('fillOpacity="0.75"');
      expect(res.code).toContain('clipRule="evenodd"');
      expect(res.code).toContain('clipPath="url(#my-clip)"');
      expect(res.code).toContain('stopColor="#ff0055"');
      expect(res.code).toContain('stopOpacity="0.9"');
      expect(res.code).toContain('textAnchor="middle"');
      expect(res.code).toContain('dominantBaseline="central"');
      expect(res.code).toContain('alignmentBaseline="middle"');
      expect(res.code).toContain('fontSize="14px"');
      expect(res.code).toContain('fontFamily="sans-serif"');
      expect(res.code).toContain('fontWeight="bold"');
      expect(res.code).toContain('letterSpacing="1px"');
      expect(res.code).toContain('wordSpacing="2px"');
      expect(res.code).toContain('xlinkHref="#glyph-1"');
      expect(res.code).toContain('xmlSpace="preserve"');
      expect(res.code).toContain('colorInterpolation="sRGB"');
      expect(res.code).toContain('colorInterpolationFilters="linearRGB"');

      // Verify no kebab-case attributes remain
      expect(res.code).not.toContain('stroke-width=');
      expect(res.code).not.toContain('stroke-linecap=');
      expect(res.code).not.toContain('stroke-linejoin=');
      expect(res.code).not.toContain('fill-rule=');
      expect(res.code).not.toContain('clip-rule=');
      expect(res.code).not.toContain('text-anchor=');
      expect(res.code).not.toContain('color-interpolation=');

      // Verify oxc_parser parses the resulting TSX
      const parsed = analyzeLitModule(res.code, { filename: 'full-svg.tsx' });
      expect(parsed).toBeDefined();

      // Verify React SSR render without errors
      const Component = evalComponent(res.code, 'FullSvgIcon');
      const htmlOutput = renderToString(React.createElement(Component));
      expect(htmlOutput).toContain('<svg');
      expect(htmlOutput).toContain('viewBox="0 0 100 100"');
    });

    it('recovers SVG tag casing for clipPath and linearGradient elements', () => {
      const code = `
        import { LitElement, html } from 'lit';
        export class GradientSvg extends LitElement {
          render() {
            return html\`
              <svg viewBox="0 0 200 200">
                <defs>
                  <linearGradient id="grad1" gradientUnits="userSpaceOnUse">
                    <stop offset="0%" stop-color="#000" />
                    <stop offset="100%" stop-color="#fff" />
                  </linearGradient>
                  <clipPath id="cp1">
                    <rect width="100" height="100" />
                  </clipPath>
                </defs>
                <rect fill="url(#grad1)" clip-path="url(#cp1)" width="200" height="200" />
              </svg>
            \`;
          }
        }
      `;

      const res = compileModule(code, { filePath: 'gradient-svg.ts' });
      expect(res.tier).toBe('Tier0Pure');
      expect(res.code).toContain('<linearGradient');
      expect(res.code).toContain('gradientUnits="userSpaceOnUse"');
      expect(res.code).toContain('stopColor="#000"');
      expect(res.code).toContain('stopColor="#fff"');
      expect(res.code).toContain('<clipPath');
      expect(res.code).toContain('clipPath="url(#cp1)"');

      const Component = evalComponent(res.code, 'GradientSvg');
      const htmlOutput = renderToString(React.createElement(Component));
      expect(htmlOutput).toContain('id="grad1"');
      expect(htmlOutput).toContain('id="cp1"');
    });
  });

  // =========================================================================
  // 3. Multiple boolean attributes with dynamic conditions
  // =========================================================================
  describe('3. Multiple boolean attributes with dynamic conditions', () => {
    it('lowers custom and data boolean attributes to {cond ? "" : undefined}', () => {
      const code = `
        import { LitElement, html } from 'lit';
        export class MultiBoolElement extends LitElement {
          render() {
            const active = true;
            const status = 'done';
            return html\`
              <button
                ?data-active=\${active}
                ?data-done=\${status === 'done'}
              >
                Trigger
              </button>
            \`;
          }
        }
      `;

      const res = compileModule(code, { filePath: 'multi-bool.ts' });
      expect(res.tier).toBe('Tier0Pure');

      // Verify custom/data boolean attribute conditional pattern: attr={cond ? "" : undefined}
      expect(res.code).toMatch(/data-active=\{active\s*\?\s*["']{2}\s*:\s*undefined\}/);
      expect(res.code).toMatch(/data-done=\{status\s*===\s*["']done["']\s*\?\s*["']{2}\s*:\s*undefined\}/);

      const Component = evalComponent(res.code, 'MultiBoolElement');
      const htmlOutput = renderToString(React.createElement(Component));
      expect(htmlOutput).toContain('data-active=""');
      expect(htmlOutput).toContain('data-done=""');
    });

    it('lowers standard HTML boolean attributes to {cond ? true : undefined}', () => {
      const code = `
        import { LitElement, html } from 'lit';
        export class StandardBoolElement extends LitElement {
          render() {
            const isDisabled = true;
            return html\`<button ?disabled=\${isDisabled}>Trigger</button>\`;
          }
        }
      `;

      const res = compileModule(code, { filePath: 'standard-bool.ts' });
      expect(res.code).toContain('disabled={isDisabled ? true : undefined}');

      const Component = evalComponent(res.code, 'StandardBoolElement');
      const htmlOutput = renderToString(React.createElement(Component));
      expect(htmlOutput).toContain('disabled=""');
    });

    it('lowers static boolean attributes without values', () => {
      const code = `
        import { LitElement, html } from 'lit';
        export class StaticBoolElement extends LitElement {
          render() {
            return html\`<input ?disabled ?required ?readonly />\`;
          }
        }
      `;

      const res = compileModule(code, { filePath: 'static-bool.ts' });
      expect(res.code).toContain('disabled');
      expect(res.code).toContain('required');
      expect(res.code).toContain('readOnly');
    });
  });

  // =========================================================================
  // 4. Static style strings with multiple properties, units, vendor prefixes, and CSS variables
  // =========================================================================
  describe('4. Static and mixed style strings', () => {
    it('lowers static style string with CSS custom properties and standard declarations', () => {
      const code = `
        import { LitElement, html } from 'lit';
        export class StandardStyleBox extends LitElement {
          render() {
            return html\`
              <div
                style="--accent-color: #0f62fe; --card-radius: 8px; margin-top: 12px; padding-bottom: 24px; font-weight: 500; opacity: 0.95; z-index: 100;"
              >
                Styled Content
              </div>
            \`;
          }
        }
      `;

      const res = compileModule(code, { filePath: 'std-style.ts' });
      expect(res.tier).toBe('Tier0Pure');

      // Check CSS variable preservation with exact -- name
      expect(res.code).toMatch(/["']--accent-color["']:\s*["']#0f62fe["']/);
      expect(res.code).toMatch(/["']--card-radius["']:\s*["']8px["']/);

      // Check kebab-to-camelCase conversion
      expect(res.code).toMatch(/marginTop:\s*["']12px["']/);
      expect(res.code).toMatch(/paddingBottom:\s*["']24px["']/);
      expect(res.code).toMatch(/fontWeight:\s*["']500["']/);
      expect(res.code).toMatch(/opacity:\s*["']0.95["']/);
      expect(res.code).toMatch(/zIndex:\s*["']100["']/);

      // Verify React SSR execution
      const Component = evalComponent(res.code, 'StandardStyleBox');
      const htmlOutput = renderToString(React.createElement(Component));
      expect(htmlOutput).toContain('style="');
      expect(htmlOutput).toContain('--accent-color:#0f62fe');
      expect(htmlOutput).toContain('margin-top:12px');
      expect(htmlOutput).toContain('padding-bottom:24px');
    });

    it('lowers vendor prefixes in css_prop_to_camel_case to valid React style properties', () => {
      const code = `
        import { LitElement, html } from 'lit';
        export class VendorPrefixBox extends LitElement {
          render() {
            return html\`
              <div style="-webkit-overflow-scrolling: touch; -ms-user-select: none;">
                Vendor
              </div>
            \`;
          }
        }
      `;

      const res = compileModule(code, { filePath: 'vendor-style.ts' });
      expect(res.code).toContain('WebkitOverflowScrolling: "touch"');
      expect(res.code).toContain('msUserSelect: "none"');

      const Component = evalComponent(res.code, 'VendorPrefixBox');
      const htmlOutput = renderToString(React.createElement(Component));
      expect(htmlOutput).toContain('-webkit-overflow-scrolling:touch');
      expect(htmlOutput).toContain('-ms-user-select:none');
    });

    it('lowers mixed dynamic style attribute with local expressions and static properties', () => {
      const code = `
        import { LitElement, html } from 'lit';
        export class MixedStyleCard extends LitElement {
          render() {
            const bg = 'navy';
            const border = 'gold';
            return html\`
              <div style="background-color: \${bg}; border-color: \${border}; padding: 16px; margin-top: 8px;">
                Mixed Card
              </div>
            \`;
          }
        }
      `;

      const res = compileModule(code, { filePath: 'mixed-style.ts' });
      expect(res.tier).toBe('Tier0Pure');
      expect(res.code).toContain('backgroundColor: bg');
      expect(res.code).toContain('borderColor: border');
      expect(res.code).toMatch(/padding:\s*["']16px["']/);
      expect(res.code).toMatch(/marginTop:\s*["']8px["']/);

      const Component = evalComponent(res.code, 'MixedStyleCard');
      const htmlOutput = renderToString(React.createElement(Component));
      expect(htmlOutput).toContain('style="background-color:navy;border-color:gold;padding:16px;margin-top:8px"');
    });
  });

  // =========================================================================
  // 5. Unkeyed array expressions and positional index key injection
  // =========================================================================
  describe('5. Unkeyed array expressions and positional index key injection', () => {
    it('injects key={index} into unkeyed array mapping with concise arrow body', () => {
      const code = `
        import { LitElement, html } from 'lit';
        export class UnkeyedConciseList extends LitElement {
          render() {
            const items = ['First', 'Second', 'Third'];
            return html\`
              <ul class="list">
                \${items.map((item) => html\`<li class="item">\${item}</li>\`)}
              </ul>
            \`;
          }
        }
      `;

      const res = compileModule(code, { filePath: 'unkeyed-concise.ts' });
      expect(res.tier).toBe('Tier0Pure');
      expect(res.code).toContain('key={index}');

      // StrictMode verification: no missing key warnings from React
      const logs: string[] = [];
      const origError = console.error;
      console.error = (...args: any[]) => logs.push(args.join(' '));
      try {
        const Component = evalComponent(res.code, 'UnkeyedConciseList');
        const htmlOutput = renderToString(React.createElement(StrictMode, null, React.createElement(Component)));
        expect(htmlOutput).toContain('First');
        expect(htmlOutput).toContain('Second');
        expect(htmlOutput).toContain('Third');
        expect(logs.some((l) => l.includes('Each child in a list should have a unique "key"'))).toBe(false);
      } finally {
        console.error = origError;
      }
    });

    it('injects key={index} into unkeyed array mapping with block body and return statement', () => {
      const code = `
        import { LitElement, html } from 'lit';
        export class UnkeyedBlockList extends LitElement {
          render() {
            const items = ['Apple', 'Banana'];
            return html\`
              <div>
                \${items.map((item) => {
                  return html\`<span class="fruit">\${item}</span>\`;
                })}
              </div>
            \`;
          }
        }
      `;

      const res = compileModule(code, { filePath: 'unkeyed-block.ts' });
      expect(res.tier).toBe('Tier0Pure');
      expect(res.code).toContain('key={index}');

      const Component = evalComponent(res.code, 'UnkeyedBlockList');
      const htmlOutput = renderToString(React.createElement(Component));
      expect(htmlOutput).toContain('Apple');
      expect(htmlOutput).toContain('Banana');
    });

    it('preserves author explicit key prop in array mapping without overwriting', () => {
      const code = `
        import { LitElement, html } from 'lit';
        export class ExplicitKeyList extends LitElement {
          render() {
            const items = [{ id: 'k1', text: 'One' }, { id: 'k2', text: 'Two' }];
            return html\`
              <div>
                \${items.map((item) => html\`<div key=\${item.id}>\${item.text}</div>\`)}
              </div>
            \`;
          }
        }
      `;

      const res = compileModule(code, { filePath: 'explicit-key.ts' });
      expect(res.code).toContain('key={item.id}');
      expect(res.code).not.toContain('key={index}');
    });
  });

  // =========================================================================
  // 6. Whitespace boundary preservation
  // =========================================================================
  describe('6. Whitespace boundary preservation', () => {
    it('preserves boundary space between inline elements via {" "}', () => {
      const code = `
        import { LitElement, html } from 'lit';
        export class SpacedSpans extends LitElement {
          render() {
            return html\`<span>Hello</span> <span>World</span>\`;
          }
        }
      `;

      const res = compileModule(code, { filePath: 'spaced-spans.ts' });
      expect(res.code).toMatch(/<span>Hello<\/span>(\s*\{["'] ["']\}\s*|\s*)<span>World<\/span>/);

      const Component = evalComponent(res.code, 'SpacedSpans');
      const htmlOutput = renderToString(React.createElement(Component));
      expect(htmlOutput.replace(/<!-- -->/g, ' ')).toContain('<span>Hello</span> <span>World</span>');
    });

    it('preserves text node leading and trailing spaces', () => {
      const code = `
        import { LitElement, html } from 'lit';
        export class LeadingTrailingSpaced extends LitElement {
          render() {
            return html\`<p> Prefix <span>Middle</span> Suffix </p>\`;
          }
        }
      `;

      const res = compileModule(code, { filePath: 'leading-trailing.ts' });
      expect(res.code).toContain('{" "}');

      const Component = evalComponent(res.code, 'LeadingTrailingSpaced');
      const htmlOutput = renderToString(React.createElement(Component));
      expect(htmlOutput).toContain('Prefix');
      expect(htmlOutput).toContain('Suffix');
    });
  });

  // =========================================================================
  // 7. Expressions lowering: nothing, undefined, ternary, this.property
  // =========================================================================
  describe('7. Expressions lowering: nothing, undefined, ternary, this.property', () => {
    it('lowers lit nothing and undefined sentinels to null', () => {
      const code = `
        import { LitElement, html, nothing } from 'lit';
        export class SentinelsComp extends LitElement {
          render() {
            return html\`<div>\${nothing}\${undefined}\${null}</div>\`;
          }
        }
      `;

      const res = compileModule(code, { filePath: 'sentinels.ts' });
      expect(res.tier).toBe('Tier0Pure');
      expect(res.code).toContain('{null}');
      expect(res.code).not.toContain('nothing');

      const Component = evalComponent(res.code, 'SentinelsComp');
      const htmlOutput = renderToString(React.createElement(Component));
      expect(htmlOutput).toBe('<div></div>');
    });

    it('lowers conditional ternary with nothing to null alternate', () => {
      const code = `
        import { LitElement, html, nothing } from 'lit';
        export class TernaryNothingComp extends LitElement {
          render() {
            const isActive = true;
            return html\`
              <div>
                \${isActive ? 'Active Badge' : nothing}
              </div>
            \`;
          }
        }
      `;

      const res = compileModule(code, { filePath: 'ternary-nothing.ts' });
      expect(res.tier).toBe('Tier0Pure');
      expect(res.code).toContain('isActive ? "Active Badge" : null');
      expect(res.code).not.toContain('nothing');

      const Component = evalComponent(res.code, 'TernaryNothingComp');
      const activeHtml = renderToString(React.createElement(Component));
      expect(activeHtml).toContain('Active Badge');
    });

    it('rewrites this.property to props.property in child expressions', () => {
      const code = `
        import { LitElement, html } from 'lit';
        export class ChildThisComp extends LitElement {
          render() {
            return html\`
              <div>
                <span>\${this.user.profile.displayName}</span>
              </div>
            \`;
          }
        }
      `;

      const res = compileModule(code, { filePath: 'child-this.ts' });
      expect(res.code).toContain('{props.user.profile.displayName}');
      expect(res.code).not.toContain('{this.user.profile.displayName}');

      const Component = evalComponent(res.code, 'ChildThisComp');
      const htmlOutput = renderToString(React.createElement(Component, { user: { profile: { displayName: 'Alice' } } }));
      expect(htmlOutput).toContain('Alice');
    });

    it('rewrites this.test in conditional ternary expression in child position', () => {
      const code = `
        import { LitElement, html, nothing } from 'lit';
        export class TernaryThisComp extends LitElement {
          render() {
            return html\`<div>\${this.isActive ? 'Active' : nothing}</div>\`;
          }
        }
      `;

      const res = compileModule(code, { filePath: 'ternary-this.ts' });
      expect(res.code).toContain('props.isActive ? "Active" : null');
      expect(res.code).not.toContain('this.isActive ? "Active" : null');

      const Component = evalComponent(res.code, 'TernaryThisComp');
      const activeHtml = renderToString(React.createElement(Component, { isActive: true }));
      expect(activeHtml).toContain('Active');
      const inactiveHtml = renderToString(React.createElement(Component, { isActive: false }));
      expect(inactiveHtml).toBe('<div></div>');
    });

    it('rewrites this.items.map callee in unkeyed array mapping to props.items.map', () => {
      const code = `
        import { LitElement, html } from 'lit';
        export class ArrayMapThisComp extends LitElement {
          render() {
            return html\`
              <ul>
                \${this.items.map((item) => html\`<li>\${item}</li>\`)}
              </ul>
            \`;
          }
        }
      `;

      const res = compileModule(code, { filePath: 'array-map-this.ts' });
      expect(res.code).toContain('props.items.map(');
      expect(res.code).not.toContain('this.items.map(');

      const Component = evalComponent(res.code, 'ArrayMapThisComp');
      const htmlOutput = renderToString(React.createElement(Component, { items: ['Alpha', 'Beta'] }));
      expect(htmlOutput).toContain('<li>Alpha</li>');
      expect(htmlOutput).toContain('<li>Beta</li>');
    });

    it('preserves preceding variable declarations in render and rewrites their this.* access', () => {
      const code = `
        import { LitElement, html } from 'lit';
        export class PrecedingStatementsComp extends LitElement {
          render() {
            const isReady = this.status === 'ready';
            const count = this.items.length;
            const fullTitle = \`Status: \${isReady ? 'Active' : 'Idle'}\`;
            return html\`
              <div class="status-box">
                <h4>\${fullTitle}</h4>
                <span>Count: \${count}</span>
              </div>
            \`;
          }
        }
      `;

      const res = compileModule(code, { filePath: 'preceding.ts' });
      // Preceding statements this.* access is rewritten by rewrite_statement_this_to_props
      expect(res.code).toContain('const isReady = props.status === "ready";');
      expect(res.code).toContain('const count = props.items.length;');
      expect(res.code).toContain('const fullTitle = `Status: ${isReady ? "Active" : "Idle"}`;');

      const Component = evalComponent(res.code, 'PrecedingStatementsComp');
      const htmlOutput = renderToString(React.createElement(Component, { status: 'ready', items: [1, 2, 3] }));
      expect(htmlOutput).toContain('Status: Active');
      expect(htmlOutput.replace(/<!-- -->/g, '')).toContain('Count: 3');
    });
  });

  // =========================================================================
  // 8. Invariant audit: zero string splicing or re-parsing in emit_jsx.rs
  // =========================================================================
  describe('8. Invariant audit: AST builder codegen without string splicing', () => {
    it('verifies packages/morph-to-react/src/emit_jsx.rs has zero occurrences of format!, push_str, or Parser::new for code synthesis', () => {
      const emitJsxPath = path.resolve(rootDir, 'packages/morph-to-react/src/emit_jsx.rs');
      expect(fs.existsSync(emitJsxPath)).toBe(true);

      const content = fs.readFileSync(emitJsxPath, 'utf-8');

      // 1. Zero occurrences of format!
      expect(content).not.toContain('format!');

      // 2. Zero occurrences of Parser::new
      expect(content).not.toContain('Parser::new');

      // 3. AstBuilder presence
      expect(content).toContain('AstBuilder');
      expect(content).toContain('JSXElement::boxed');
      expect(content).toContain('JSXOpeningElement::boxed');
      expect(content).toContain('JSXClosingElement::boxed');
      expect(content).toContain('JSXAttribute::boxed');
      expect(content).toContain('JSXExpressionContainer::boxed');
      expect(content).toContain('JSXFragment::boxed');
      expect(content).toContain('Function::boxed');
    });
  });

  // =========================================================================
  // 9. Wave 2 adversarial remediation stress verification
  // =========================================================================
  describe('9. Wave 2 adversarial remediation stress verification', () => {
    it('empirically verifies 12 standard HTML boolean attributes render and omit correctly in React SSR', () => {
      const code = `
        import { LitElement, html } from 'lit';
        export class ExhaustiveBooleans extends LitElement {
          render() {
            return html\`
              <form
                ?novalidate=\${this.isNovalidate}
              >
                <input
                  ?disabled=\${this.isDisabled}
                  ?required=\${this.isRequired}
                  ?readonly=\${this.isReadonly}
                  ?autofocus=\${this.isAutofocus}
                  ?checked=\${this.isChecked}
                />
                <select ?multiple=\${this.isMultiple}>
                  <option ?selected=\${this.isSelected}>Option</option>
                </select>
                <details ?open=\${this.isOpen}>
                  <summary>Details</summary>
                </details>
                <ol ?reversed=\${this.isReversed}>
                  <li>Item</li>
                </ol>
                <div ?hidden=\${this.isHidden} ?inert=\${this.isInert} ?data-active=\${this.isActive}>
                  Status Box
                </div>
              </form>
            \`;
          }
        }
      `;

      const res = compileModule(code, { filePath: 'exhaustive-booleans.ts' });

      // Verify AST lowering output patterns
      expect(res.code).toContain('disabled={props.isDisabled ? true : undefined}');
      expect(res.code).toContain('required={props.isRequired ? true : undefined}');
      expect(res.code).toContain('readOnly={props.isReadonly ? true : undefined}');
      expect(res.code).toContain('autoFocus={props.isAutofocus ? true : undefined}');
      expect(res.code).toContain('checked={props.isChecked ? true : undefined}');
      expect(res.code).toContain('multiple={props.isMultiple ? true : undefined}');
      expect(res.code).toContain('selected={props.isSelected ? true : undefined}');
      expect(res.code).toContain('open={props.isOpen ? true : undefined}');
      expect(res.code).toContain('reversed={props.isReversed ? true : undefined}');
      expect(res.code).toContain('hidden={props.isHidden ? true : undefined}');
      expect(res.code).toContain('inert={props.isInert ? true : undefined}');
      expect(res.code).toContain('noValidate={props.isNovalidate ? true : undefined}');
      expect(res.code).toContain('data-active={props.isActive ? "" : undefined}');

      const Component = evalComponent(res.code, 'ExhaustiveBooleans');

      // 1. All true: every attribute must be present in React SSR output
      const allTrueHtml = renderToString(
        React.createElement(Component, {
          isDisabled: true,
          isRequired: true,
          isReadonly: true,
          isAutofocus: true,
          isChecked: true,
          isMultiple: true,
          isSelected: true,
          isOpen: true,
          isReversed: true,
          isHidden: true,
          isInert: true,
          isNovalidate: true,
          isActive: true,
        }),
      );

      expect(allTrueHtml).toContain('disabled=""');
      expect(allTrueHtml).toContain('required=""');
      expect(allTrueHtml).toContain('readOnly=""');
      expect(allTrueHtml).toContain('autofocus=""');
      expect(allTrueHtml).toContain('checked=""');
      expect(allTrueHtml).toContain('multiple=""');
      expect(allTrueHtml).toContain('selected=""');
      expect(allTrueHtml).toContain('open=""');
      expect(allTrueHtml).toContain('reversed=""');
      expect(allTrueHtml).toContain('hidden=""');
      expect(allTrueHtml).toContain('inert=""');
      expect(allTrueHtml).toContain('noValidate=""');
      expect(allTrueHtml).toContain('data-active=""');

      // 2. All false: all attributes must be completely omitted from React SSR output
      const allFalseHtml = renderToString(
        React.createElement(Component, {
          isDisabled: false,
          isRequired: false,
          isReadonly: false,
          isAutofocus: false,
          isChecked: false,
          isMultiple: false,
          isSelected: false,
          isOpen: false,
          isReversed: false,
          isHidden: false,
          isInert: false,
          isNovalidate: false,
          isActive: false,
        }),
      );

      expect(allFalseHtml).not.toContain('disabled');
      expect(allFalseHtml).not.toContain('required');
      expect(allFalseHtml).not.toContain('readonly');
      expect(allFalseHtml).not.toContain('autofocus');
      expect(allFalseHtml).not.toContain('checked');
      expect(allFalseHtml).not.toContain('multiple');
      expect(allFalseHtml).not.toContain('selected');
      expect(allFalseHtml).not.toContain('open');
      expect(allFalseHtml).not.toContain('reversed');
      expect(allFalseHtml).not.toContain('hidden');
      expect(allFalseHtml).not.toContain('inert');
      expect(allFalseHtml).not.toContain('novalidate');
      expect(allFalseHtml).not.toContain('data-active');
    });

    it('empirically verifies 8 vendor-prefixed CSS properties serialize to valid CSS in React SSR', () => {
      const code = `
        import { LitElement, html } from 'lit';
        export class ExhaustiveVendorStyle extends LitElement {
          render() {
            return html\`
              <div
                style="
                  -webkit-overflow-scrolling: touch;
                  -webkit-line-clamp: 3;
                  -webkit-tap-highlight-color: transparent;
                  -ms-user-select: none;
                  -ms-overflow-style: none;
                  -moz-appearance: none;
                  -moz-osx-font-smoothing: grayscale;
                  -o-transition: opacity 0.2s ease;
                  --webkit-custom-token: 16px;
                "
              >
                Vendor Box
              </div>
            \`;
          }
        }
      `;

      const res = compileModule(code, { filePath: 'exhaustive-vendor.ts' });
      expect(res.tier).toBe('Tier0Pure');

      // Verify exact camelCase naming emitted in JSX style object
      expect(res.code).toContain('WebkitOverflowScrolling: "touch"');
      expect(res.code).toContain('WebkitLineClamp: "3"');
      expect(res.code).toContain('WebkitTapHighlightColor: "transparent"');
      expect(res.code).toContain('msUserSelect: "none"');
      expect(res.code).toContain('msOverflowStyle: "none"');
      expect(res.code).toContain('MozAppearance: "none"');
      expect(res.code).toContain('MozOsxFontSmoothing: "grayscale"');
      expect(res.code).toContain('OTransition: "opacity 0.2s ease"');
      expect(res.code).toContain('"--webkit-custom-token": "16px"');

      // Verify no invalid lowercased prefixed property names
      expect(res.code).not.toContain('Webkitoverflow');
      expect(res.code).not.toContain('msuser');
      expect(res.code).not.toContain('msoverflow');

      // Verify React SSR execution produces standard hyphenated CSS strings
      const Component = evalComponent(res.code, 'ExhaustiveVendorStyle');
      const htmlOutput = renderToString(React.createElement(Component));

      expect(htmlOutput).toContain('-webkit-overflow-scrolling:touch');
      expect(htmlOutput).toContain('-webkit-line-clamp:3');
      expect(htmlOutput).toContain('-webkit-tap-highlight-color:transparent');
      expect(htmlOutput).toContain('-ms-user-select:none');
      expect(htmlOutput).toContain('-ms-overflow-style:none');
      expect(htmlOutput).toContain('-moz-appearance:none');
      expect(htmlOutput).toContain('-moz-osx-font-smoothing:grayscale');
      expect(htmlOutput).toContain('-o-transition:opacity 0.2s ease');
      expect(htmlOutput).toContain('--webkit-custom-token:16px');
    });

    it('empirically verifies complex nested and chained this.* child expressions without runtime TypeError', () => {
      const code = `
        import { LitElement, html, nothing } from 'lit';
        export class ComplexChildExpressions extends LitElement {
          render() {
            return html\`
              <div class="profile-card">
                <h3>\${this.user.account.tier}</h3>
                <div class="badge">
                  \${this.status === 'admin' ? this.adminBadge : (this.isModerator ? this.modBadge : null)}
                </div>
                <p class="greeting">
                  \${this.dictionary[this.selectedLanguage][this.keyName]}
                </p>
                <span class="formatted">
                  \${this.formatMessage(this.prefix, this.suffix)}
                </span>
                <span class="count">
                  \${!this.disabled && this.count > 0 ? this.count : null}
                </span>
                <p class="template-str">
                  \${\`User: \${this.username} - Role: \${this.role}\`}
                </p>
              </div>
            \`;
          }
        }
      `;

      const res = compileModule(code, { filePath: 'complex-child.ts' });

      // Verify AST rewrites this to props across all expression kinds
      expect(res.code).toContain('props.user.account.tier');
      expect(res.code).toContain('props.status === "admin"');
      expect(res.code).toContain('props.adminBadge');
      expect(res.code).toContain('props.isModerator ? props.modBadge : null');
      expect(res.code).toContain('props.dictionary[props.selectedLanguage][props.keyName]');
      expect(res.code).toContain('props.formatMessage(props.prefix, props.suffix)');
      expect(res.code).toContain('!props.disabled && props.count > 0 ? props.count : null');
      expect(res.code).toContain('`User: ${props.username} - Role: ${props.role}`');

      // Verify zero occurrences of raw this in emitted JSX expressions
      expect(res.code).not.toContain('{this.');
      expect(res.code).not.toContain('${this.');

      const Component = evalComponent(res.code, 'ComplexChildExpressions');

      // 1. Evaluate with admin props: all expressions evaluate cleanly in React SSR
      const adminHtml = renderToString(
        React.createElement(Component, {
          user: { account: { tier: 'Platinum Enterprise' } },
          status: 'admin',
          adminBadge: 'Verified Platform Administrator',
          isModerator: false,
          dictionary: { en: { greeting: 'Welcome back to the dashboard' } },
          selectedLanguage: 'en',
          keyName: 'greeting',
          formatMessage: (p: string, s: string) => `[${p}] >> [${s}]`,
          prefix: 'ORIGIN',
          suffix: 'DESTINATION',
          disabled: false,
          count: 142,
          username: 'sysadmin',
          role: 'Principal Engineer',
        }),
      );

      expect(adminHtml).toContain('Platinum Enterprise');
      expect(adminHtml).toContain('Verified Platform Administrator');
      expect(adminHtml).toContain('Welcome back to the dashboard');
      expect(adminHtml).toContain('[ORIGIN] &gt;&gt; [DESTINATION]');
      expect(adminHtml).toContain('142');
      expect(adminHtml).toContain('User: sysadmin - Role: Principal Engineer');

      // 2. Evaluate with fallback/nothing branch: verifies nested ternary with nothing lowers to null
      const memberHtml = renderToString(
        React.createElement(Component, {
          user: { account: { tier: 'Basic' } },
          status: 'standard',
          adminBadge: 'Admin',
          isModerator: false,
          dictionary: { en: { greeting: 'Hello' } },
          selectedLanguage: 'en',
          keyName: 'greeting',
          formatMessage: (p: string, s: string) => `${p}-${s}`,
          prefix: 'A',
          suffix: 'B',
          disabled: true,
          count: 0,
          username: 'user1',
          role: 'Viewer',
        }),
      );

      expect(memberHtml).toContain('<div class="badge">');
      expect(memberHtml).not.toContain('Verified Platform Administrator');
      expect(memberHtml).not.toContain('Mod');
    });

    it('empirically verifies chained array mapping and internal this.* resolution without runtime TypeError', () => {
      const code = `
        import { LitElement, html } from 'lit';
        export class ChainedArrayMapping extends LitElement {
          render() {
            return html\`
              <div class="container">
                <section class="active-items">
                  \${this.items
                    .filter((x) => x.active)
                    .map((item) => html\`<span class="active-item">\${this.prefix}: \${item.name}</span>\`)}
                </section>
                <section class="categories">
                  \${this.categories.map((cat) => {
                    const count = this.getCount(cat.id);
                    return html\`<div class="cat">\${cat.title} (\${count})</div>\`;
                  })}
                </section>
              </div>
            \`;
          }
        }
      `;

      const res = compileModule(code, { filePath: 'chained-array.ts' });

      // Callee and statements rewritten
      expect(res.code).toContain('props.items');
      expect(res.code).toContain('props.categories.map(');
      expect(res.code).toContain('const count = props.getCount(cat.id);');
      expect(res.code).toContain('{props.prefix}');

      // Positional key injection verified
      expect(res.code).toContain('key={index}');

      const logs: string[] = [];
      const origError = console.error;
      console.error = (...args: any[]) => logs.push(args.join(' '));
      try {
        const Component = evalComponent(res.code, 'ChainedArrayMapping');
        const htmlOutput = renderToString(
          React.createElement(
            StrictMode,
            null,
            React.createElement(Component, {
              prefix: 'TAG',
              items: [
                { name: 'Alpha', active: true },
                { name: 'Beta', active: false },
                { name: 'Gamma', active: true },
              ],
              categories: [
                { id: 'c1', title: 'Hardware' },
                { id: 'c2', title: 'Software' },
              ],
              getCount: (id: string) => (id === 'c1' ? 10 : 25),
            }),
          ),
        );

        const normalizedHtml = htmlOutput.replace(/<!-- -->/g, '');
        expect(normalizedHtml).toContain('TAG: Alpha');
        expect(normalizedHtml).toContain('TAG: Gamma');
        expect(normalizedHtml).not.toContain('Beta');
        expect(normalizedHtml).toContain('Hardware (10)');
        expect(normalizedHtml).toContain('Software (25)');
        expect(logs.some((l) => l.includes('Each child in a list should have a unique "key"'))).toBe(false);
      } finally {
        console.error = origError;
      }
    });

    it('empirically verifies author explicit keys in nested and block array mappings are never duplicated', () => {
      const code = `
        import { LitElement, html } from 'lit';
        export class ExplicitKeyArrayMapping extends LitElement {
          render() {
            return html\`
              <table>
                <tbody>
                  \${this.rows.map((row) => html\`<tr key=\${row.uuid}><td>\${row.name}</td></tr>\`)}
                </tbody>
              </table>
              <div class="cards">
                \${this.cards.map((card) => {
                  return html\`<div key=\${card.slug} class="card">\${card.title}</div>\`;
                })}
              </div>
            \`;
          }
        }
      `;

      const res = compileModule(code, { filePath: 'explicit-keys.ts' });

      // Explicit keys preserved
      expect(res.code).toContain('key={row.uuid}');
      expect(res.code).toContain('key={card.slug}');

      // Key is not duplicated
      expect(res.code).not.toContain('key={index}');

      const Component = evalComponent(res.code, 'ExplicitKeyArrayMapping');
      const htmlOutput = renderToString(
        React.createElement(Component, {
          rows: [{ uuid: 'u-1', name: 'Row One' }],
          cards: [{ slug: 'card-1', title: 'Card One' }],
        }),
      );

      expect(htmlOutput).toContain('Row One');
      expect(htmlOutput).toContain('Card One');
    });
  });
});
