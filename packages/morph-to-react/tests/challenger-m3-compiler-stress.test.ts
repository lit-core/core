import React from 'react';
import { renderToString } from 'react-dom/server';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { stopNonComposedEvent, toEventPropName } from '../runtime/events.js';
import * as morphRuntime from '../runtime/index.js';
import { compileModule } from '../src/index.js';

/**
 * Evaluates emitted component code inside a CommonJS module context,
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

describe('Milestone 3 Challenger: Empirical Directive & Compiler Stress Testing', () => {
  // =========================================================================
  // 1. Directive: classMap empirical stress testing
  // =========================================================================
  describe('1. Directive: classMap empirical stress testing', () => {
    it('lowers object literal classMap with mixed static, truthy, and falsy filters', () => {
      const code = `
        import { LitElement, html } from 'lit';
        import { classMap } from 'lit/directives/class-map.js';
        export class CardClassMap extends LitElement {
          render() {
            const isSelected = true;
            const isDisabled = false;
            const hasError = true;
            return html\`
              <div class=\${classMap({
                'base-card': true,
                'card--selected': isSelected,
                'card--disabled': isDisabled,
                'has-error': hasError,
                'omitted-zero': 0,
                'omitted-empty': '',
                'active-one': 1,
              })}>Card Content</div>
            \`;
          }
        }
      `;
      const res = compileModule(code, { filePath: 'card-class-map.ts' });
      expect(res.code).not.toContain('classMap(');
      expect(res.code).toContain('className=');

      const Component = evalComponent(res.code, 'CardClassMap');
      const htmlOutput = renderToString(React.createElement(Component));

      // Verifies truthy classes are present
      expect(htmlOutput).toContain('base-card');
      expect(htmlOutput).toContain('card--selected');
      expect(htmlOutput).toContain('has-error');
      expect(htmlOutput).toContain('active-one');

      // Verifies falsy classes are strictly omitted
      expect(htmlOutput).not.toContain('card--disabled');
      expect(htmlOutput).not.toContain('omitted-zero');
      expect(htmlOutput).not.toContain('omitted-empty');
    });

    it('handles empty object literal classMap({}) by generating empty string without error', () => {
      const code = `
        import { LitElement, html } from 'lit';
        import { classMap } from 'lit/directives/class-map.js';
        export class EmptyClassMap extends LitElement {
          render() {
            return html\`<div class=\${classMap({})}>Empty</div>\`;
          }
        }
      `;
      const res = compileModule(code, { filePath: 'empty-class-map.ts' });
      const Component = evalComponent(res.code, 'EmptyClassMap');
      const htmlOutput = renderToString(React.createElement(Component));
      expect(htmlOutput).toContain('<div class="">Empty</div>');
    });

    it('documents dynamic non-literal classMap fallback emission (_classMap identifier)', () => {
      const code = `
        import { LitElement, html } from 'lit';
        import { classMap } from 'lit/directives/class-map.js';
        export class DynamicClassMapObj extends LitElement {
          render() {
            const dynamicClasses = { active: true, disabled: false };
            return html\`<div class=\${classMap(dynamicClasses)}>Dynamic</div>\`;
          }
        }
      `;
      const res = compileModule(code, { filePath: 'dynamic-class-map.ts' });
      // Empirically confirms that non-literal expressions fall back to calling _classMap
      expect(res.code).toContain('_classMap(dynamicClasses)');
      expect(res.code).toMatch(/import\s*\{[^}]*_classMap[^}]*\}\s*from\s*['"]@lit-core\/morph-to-react\/runtime['"]/);

      const Component = evalComponent(res.code, 'DynamicClassMapObj');
      const htmlOutput = renderToString(React.createElement(Component));
      expect(htmlOutput).toContain('class="active"');
      expect(htmlOutput).not.toContain('disabled');
    });
  });

  // =========================================================================
  // 2. Directive: styleMap empirical stress testing
  // =========================================================================
  describe('2. Directive: styleMap empirical stress testing', () => {
    it('converts kebab-case to camelCase and preserves CSS custom properties with -- prefix', () => {
      const code = `
        import { LitElement, html } from 'lit';
        import { styleMap } from 'lit/directives/style-map.js';
        export class StyledPanel extends LitElement {
          render() {
            const primaryColor = '#0f62fe';
            const radius = '8px';
            return html\`
              <div style=\${styleMap({
                'font-size': '14px',
                'background-color': '#ffffff',
                'line-height': '1.5',
                'border-radius': radius,
                'z-index': 100,
                '--brand-color': primaryColor,
                '--panel-elevation': '4px',
              })}>Styled Content</div>
            \`;
          }
        }
      `;
      const res = compileModule(code, { filePath: 'styled-panel.ts' });
      expect(res.code).not.toContain('styleMap(');
      expect(res.code).toContain('fontSize: "14px"');
      expect(res.code).toContain('backgroundColor: "#ffffff"');
      expect(res.code).toContain('lineHeight: "1.5"');
      expect(res.code).toContain('borderRadius: radius');
      expect(res.code).toContain('zIndex: 100');
      expect(res.code).toContain('"--brand-color": primaryColor');
      expect(res.code).toContain('"--panel-elevation": "4px"');

      const Component = evalComponent(res.code, 'StyledPanel');
      const htmlOutput = renderToString(React.createElement(Component));

      // React 19 SSR outputs inline style declaration
      expect(htmlOutput).toContain('font-size:14px');
      expect(htmlOutput).toContain('background-color:#ffffff');
      expect(htmlOutput).toContain('line-height:1.5');
      expect(htmlOutput).toContain('border-radius:8px');
      expect(htmlOutput).toContain('z-index:100');
      expect(htmlOutput).toContain('--brand-color:#0f62fe');
      expect(htmlOutput).toContain('--panel-elevation:4px');
    });

    it('documents dynamic non-literal styleMap fallback emission (_styleMap identifier)', () => {
      const code = `
        import { LitElement, html } from 'lit';
        import { styleMap } from 'lit/directives/style-map.js';
        export class DynamicStyleMapObj extends LitElement {
          render() {
            const dynamicStyles = { color: 'green', '--custom-prop': '10px' };
            return html\`<div style=\${styleMap(dynamicStyles)}>Dynamic Style</div>\`;
          }
        }
      `;
      const res = compileModule(code, { filePath: 'dynamic-style-map.ts' });
      expect(res.code).toContain('_styleMap(dynamicStyles)');
      expect(res.code).toMatch(/import\s*\{[^}]*_styleMap[^}]*\}\s*from\s*['"]@lit-core\/morph-to-react\/runtime['"]/);

      const Component = evalComponent(res.code, 'DynamicStyleMapObj');
      const htmlOutput = renderToString(React.createElement(Component));
      expect(htmlOutput).toContain('color:green');
      expect(htmlOutput).toContain('--custom-prop:10px');
    });
  });

  // =========================================================================
  // 3. Directive: ifDefined empirical stress testing
  // =========================================================================
  describe('3. Directive: ifDefined empirical stress testing', () => {
    it('preserves defined attribute values and removes undefined and null attributes in SSR', () => {
      const code = `
        import { LitElement, html } from 'lit';
        import { ifDefined } from 'lit/directives/if-defined.js';
        export class IfDefElements extends LitElement {
          render() {
            const definedLabel = 'Save changes';
            const undefinedTitle = undefined;
            const nullDescription = null;
            return html\`
              <button
                aria-label=\${ifDefined(definedLabel)}
                title=\${ifDefined(undefinedTitle)}
                aria-description=\${ifDefined(nullDescription)}
              >
                Click
              </button>
            \`;
          }
        }
      `;
      const res = compileModule(code, { filePath: 'if-def.ts' });
      expect(res.code).not.toContain('ifDefined(');

      const Component = evalComponent(res.code, 'IfDefElements');
      const htmlOutput = renderToString(React.createElement(Component));

      // Defined label must be rendered
      expect(htmlOutput).toContain('aria-label="Save changes"');
      // Undefined title and null description must be completely omitted from DOM attributes
      expect(htmlOutput).not.toContain('title=');
      expect(htmlOutput).not.toContain('aria-description=');
    });

    it('lowers ifDefined in child position to (val ?? null)', () => {
      const code = `
        import { LitElement, html } from 'lit';
        import { ifDefined } from 'lit/directives/if-defined.js';
        export class IfDefChild extends LitElement {
          render() {
            const definedText = 'Active notice';
            const undefinedText = undefined;
            const nullText = null;
            return html\`
              <div>
                <span class="c1">\${ifDefined(definedText)}</span>
                <span class="c2">\${ifDefined(undefinedText)}</span>
                <span class="c3">\${ifDefined(nullText)}</span>
              </div>
            \`;
          }
        }
      `;
      const res = compileModule(code, { filePath: 'if-def-child.ts' });
      expect(res.code).not.toContain('ifDefined(');

      const Component = evalComponent(res.code, 'IfDefChild');
      const htmlOutput = renderToString(React.createElement(Component));
      expect(htmlOutput).toContain('<span class="c1">Active notice</span>');
      expect(htmlOutput).toContain('<span class="c2"></span>');
      expect(htmlOutput).toContain('<span class="c3"></span>');
    });
  });

  // =========================================================================
  // 4. Directive: when conditional branching empirical stress testing
  // =========================================================================
  describe('4. Directive: when conditional branching empirical stress testing', () => {
    it('evaluates truthy and falsy branches and injects distinct keys', () => {
      const code = `
        import { LitElement, html } from 'lit';
        import { when } from 'lit/directives/when.js';
        export class WhenBranching extends LitElement {
          render() {
            const isReady = false;
            return html\`
              <div class="container">
                \${when(isReady, () => html\`<span class="ready">System ready</span>\`, () => html\`<span class="waiting">Connecting...</span>\`)}
              </div>
            \`;
          }
        }
      `;
      const res = compileModule(code, { filePath: 'when-branching.ts' });
      expect(res.code).not.toContain('when(');
      expect(res.code).toContain('key="when-true"');
      expect(res.code).toContain('key="when-false"');

      const Component = evalComponent(res.code, 'WhenBranching');
      const htmlOutput = renderToString(React.createElement(Component));
      expect(htmlOutput).toContain('<span class="waiting">Connecting...</span>');
      expect(htmlOutput).not.toContain('System ready');
    });

    it('renders null when 2-argument when condition is falsy', () => {
      const code = `
        import { LitElement, html } from 'lit';
        import { when } from 'lit/directives/when.js';
        export class WhenTwoArgs extends LitElement {
          render() {
            const hasAlert = false;
            return html\`<div>\${when(hasAlert, () => html\`<div class="alert">Alert!</div>\`)}</div>\`;
          }
        }
      `;
      const res = compileModule(code, { filePath: 'when-two-args.ts' });
      const Component = evalComponent(res.code, 'WhenTwoArgs');
      const htmlOutput = renderToString(React.createElement(Component));
      expect(htmlOutput).not.toContain('alert');
      expect(htmlOutput).toContain('<div>');
    });
  });

  // =========================================================================
  // 5. Directive: choose multi-branch matching empirical stress testing
  // =========================================================================
  describe('5. Directive: choose multi-branch matching empirical stress testing', () => {
    it('matches intermediate case in multi-case choose expression', () => {
      const code = `
        import { LitElement, html } from 'lit';
        import { choose } from 'lit/directives/choose.js';
        export class ChooseStatus extends LitElement {
          render() {
            const status = 'warning';
            return html\`
              <div class="status-box">
                \${choose(status, [
                  ['idle', () => html\`<span class="badge-idle">Idle</span>\`],
                  ['warning', () => html\`<span class="badge-warning">Warning: high load</span>\`],
                  ['critical', () => html\`<span class="badge-critical">Critical error</span>\`],
                ], () => html\`<span class="badge-unknown">Unknown</span>\`)}
              </div>
            \`;
          }
        }
      `;
      const res = compileModule(code, { filePath: 'choose-status.ts' });
      expect(res.code).not.toContain('choose(');
      expect(res.code).toContain('status === "idle"');
      expect(res.code).toContain('status === "warning"');
      expect(res.code).toContain('status === "critical"');

      const Component = evalComponent(res.code, 'ChooseStatus');
      const htmlOutput = renderToString(React.createElement(Component));
      expect(htmlOutput).toContain('<span class="badge-warning">Warning: high load</span>');
      expect(htmlOutput).not.toContain('badge-idle');
      expect(htmlOutput).not.toContain('badge-critical');
    });

    it('falls back to default branch when no choose case matches', () => {
      const code = `
        import { LitElement, html } from 'lit';
        import { choose } from 'lit/directives/choose.js';
        export class ChooseFallback extends LitElement {
          render() {
            const status = 'unknown-val';
            return html\`
              <div>
                \${choose(status, [
                  ['a', () => html\`<span>A</span>\`],
                  ['b', () => html\`<span>B</span>\`],
                ], () => html\`<span class="default-view">Default view</span>\`)}
              </div>
            \`;
          }
        }
      `;
      const res = compileModule(code, { filePath: 'choose-fallback.ts' });
      const Component = evalComponent(res.code, 'ChooseFallback');
      const htmlOutput = renderToString(React.createElement(Component));
      expect(htmlOutput).toContain('<span class="default-view">Default view</span>');
    });

    it('falls back to null when choose default case is omitted', () => {
      const code = `
        import { LitElement, html } from 'lit';
        import { choose } from 'lit/directives/choose.js';
        export class ChooseNoDef extends LitElement {
          render() {
            const status = 'no-match';
            return html\`<div>\${choose(status, [
              ['alpha', () => html\`<span>Alpha</span>\`],
            ])}</div>\`;
          }
        }
      `;
      const res = compileModule(code, { filePath: 'choose-no-def.ts' });
      expect(res.code).toContain(': null');

      const Component = evalComponent(res.code, 'ChooseNoDef');
      const htmlOutput = renderToString(React.createElement(Component));
      expect(htmlOutput).not.toContain('Alpha');
      expect(htmlOutput).toContain('<div>');
    });
  });

  // =========================================================================
  // 6. Directive: map array mapping empirical stress testing
  // =========================================================================
  describe('6. Directive: map array mapping empirical stress testing', () => {
    it('injects automatic positional key={index} for unkeyed collection items', () => {
      const code = `
        import { LitElement, html } from 'lit';
        import { map } from 'lit/directives/map.js';
        export class MapUnkeyed extends LitElement {
          render() {
            const tags = ['react', 'lit', 'oxc'];
            return html\`
              <nav>
                \${map(tags, (tag) => html\`<a href="/t/\${tag}">\${tag}</a>\`)}
              </nav>
            \`;
          }
        }
      `;
      const res = compileModule(code, { filePath: 'map-unkeyed.ts' });
      expect(res.code).not.toContain('map(tags');
      expect(res.code).toContain('tags ? tags.map((tag, index) => <a href={`/t/${tag}`} key={index}>{tag}</a>) : null');

      const Component = evalComponent(res.code, 'MapUnkeyed');
      const htmlOutput = renderToString(React.createElement(Component));
      expect(htmlOutput).toContain('<a href="/t/react">react</a>');
      expect(htmlOutput).toContain('<a href="/t/lit">lit</a>');
      expect(htmlOutput).toContain('<a href="/t/oxc">oxc</a>');
    });

    it('protects against null or undefined arrays in map directive', () => {
      const code = `
        import { LitElement, html } from 'lit';
        import { map } from 'lit/directives/map.js';
        export class MapNullSafe extends LitElement {
          render() {
            const nullItems = null;
            return html\`<ul>\${map(nullItems, (item, i) => html\`<li key=\${i}>\${item}</li>\`)}</ul>\`;
          }
        }
      `;
      const res = compileModule(code, { filePath: 'map-null.ts' });
      const Component = evalComponent(res.code, 'MapNullSafe');
      const htmlOutput = renderToString(React.createElement(Component));
      expect(htmlOutput).not.toContain('<li');
      expect(htmlOutput).toContain('<ul>');
    });
  });

  // =========================================================================
  // 7. Directive: repeat keyed item rendering empirical stress testing
  // =========================================================================
  describe('7. Directive: repeat keyed item rendering empirical stress testing', () => {
    it('lowers 3-argument repeat directive with keyFn to keyed React array map', () => {
      const code = `
        import { LitElement, html } from 'lit';
        import { repeat } from 'lit/directives/repeat.js';
        export class RepeatKeyed extends LitElement {
          render() {
            const users = [
              { id: 'u101', name: 'Alice' },
              { id: 'u102', name: 'Bob' },
            ];
            return html\`
              <ul class="users">
                \${repeat(users, (u) => u.id, (u, idx) => html\`
                  <li data-uid=\${u.id}>\${u.name} (position \${idx})</li>
                \`)}
              </ul>
            \`;
          }
        }
      `;
      const res = compileModule(code, { filePath: 'repeat-keyed.ts' });
      expect(res.code).not.toContain('repeat(users');
      expect(res.code).toContain('key={u.id}');

      const Component = evalComponent(res.code, 'RepeatKeyed');
      const htmlOutput = renderToString(React.createElement(Component));
      expect(htmlOutput).toContain('data-uid="u101"');
      expect(htmlOutput).toContain('Alice');
      expect(htmlOutput).toContain('data-uid="u102"');
      expect(htmlOutput).toContain('Bob');
    });

    it('lowers 2-argument repeat directive with named index parameter (item, pos) to key={pos}', () => {
      const code = `
        import { LitElement, html } from 'lit';
        import { repeat } from 'lit/directives/repeat.js';
        export class RepeatTwoArgsBug extends LitElement {
          render() {
            const items = ['alpha', 'beta'];
            return html\`<div>\${repeat(items, (item, pos) => html\`<span>\${item}</span>\`)}</div>\`;
          }
        }
      `;
      const res = compileModule(code, { filePath: 'repeat-pos.ts' });
      expect(res.code).toContain('key={pos}');
      expect(res.code).toContain('(item, pos)');

      const Component = evalComponent(res.code, 'RepeatTwoArgsBug');
      const htmlOutput = renderToString(React.createElement(Component));
      expect(htmlOutput).toContain('<span>alpha</span><span>beta</span>');

      // Also verify 1-param arrow function receives synthetic index parameter
      const codeSingleParam = `
        import { LitElement, html } from 'lit';
        import { repeat } from 'lit/directives/repeat.js';
        export class RepeatSingleParam extends LitElement {
          render() {
            const items = ['alpha', 'beta'];
            return html\`<div>\${repeat(items, (item) => html\`<span>\${item}</span>\`)}</div>\`;
          }
        }
      `;
      const resSingle = compileModule(codeSingleParam, { filePath: 'repeat-single.ts' });
      expect(resSingle.code).toContain('key={index}');
      expect(resSingle.code).toContain('(item, index)');

      const ComponentSingle = evalComponent(resSingle.code, 'RepeatSingleParam');
      const htmlOutputSingle = renderToString(React.createElement(ComponentSingle));
      expect(htmlOutputSingle).toContain('<span>alpha</span><span>beta</span>');
    });
  });

  // =========================================================================
  // 8. Directive: join delimiter insertion empirical stress testing
  // =========================================================================
  describe('8. Directive: join delimiter insertion empirical stress testing', () => {
    it('lowers join directive to array join method with delimiter', () => {
      const code = `
        import { LitElement, html } from 'lit';
        import { join } from 'lit/directives/join.js';
        export class JoinSequence extends LitElement {
          render() {
            const fruits = ['Apple', 'Banana', 'Cherry'];
            return html\`<p class="fruits">\${join(fruits, ' | ')}</p>\`;
          }
        }
      `;
      const res = compileModule(code, { filePath: 'join-seq.ts' });
      expect(res.code).not.toContain('join(fruits');
      expect(res.code).toContain('fruits ? fruits.join(" | ") : null');

      const Component = evalComponent(res.code, 'JoinSequence');
      const htmlOutput = renderToString(React.createElement(Component));
      expect(htmlOutput).toContain('<p class="fruits">Apple | Banana | Cherry</p>');
    });

    it('returns empty string when single item array has no separator to insert', () => {
      const code = `
        import { LitElement, html } from 'lit';
        import { join } from 'lit/directives/join.js';
        export class JoinSingle extends LitElement {
          render() {
            const single = ['Solitary'];
            return html\`<span>\${join(single, ' --- ')}</span>\`;
          }
        }
      `;
      const res = compileModule(code, { filePath: 'join-single.ts' });
      const Component = evalComponent(res.code, 'JoinSingle');
      const htmlOutput = renderToString(React.createElement(Component));
      expect(htmlOutput).toContain('<span>Solitary</span>');
    });
  });

  // =========================================================================
  // 9. Directive: range numeric sequence generation empirical stress testing
  // =========================================================================
  describe('9. Directive: range sequence generation empirical stress testing', () => {
    it('lowers range(n) statement to static numeric sequence array [0..n-1]', () => {
      const code = `
        import { LitElement, html } from 'lit';
        import { range } from 'lit/directives/range.js';
        export class RangeStatic extends LitElement {
          render() {
            const sequence = range(5);
            return html\`<div>Length: \${sequence.length}, First: \${sequence[0]}, Last: \${sequence[4]}</div>\`;
          }
        }
      `;
      const res = compileModule(code, { filePath: 'range-static.ts' });
      expect(res.code).not.toContain('range(5)');
      expect(res.code).toMatch(/const sequence = \[\s*0,\s*1,\s*2,\s*3,\s*4\s*\];/);

      const Component = evalComponent(res.code, 'RangeStatic');
      const htmlOutput = renderToString(React.createElement(Component));
      expect(htmlOutput).toContain('5');
      expect(htmlOutput).toContain('0');
      expect(htmlOutput).toContain('4');
    });

    it('lowers multi-argument range(start, end) to static sequence array [start..end-1]', () => {
      const code = `
        import { LitElement, html } from 'lit';
        import { range } from 'lit/directives/range.js';
        export class RangeMultiArgBug extends LitElement {
          render() {
            const nums = range(2, 6);
            return html\`<div>\${nums.length}</div>\`;
          }
        }
      `;
      const res = compileModule(code, { filePath: 'range-multi.ts' });
      // In Lit, range(2, 6) produces [2, 3, 4, 5] (length 4).
      expect(res.code).not.toContain('const nums = [0, 1];');
      expect(res.code).toContain('2');
      expect(res.code).toContain('3');
      expect(res.code).toContain('4');
      expect(res.code).toContain('5');

      const Component = evalComponent(res.code, 'RangeMultiArgBug');
      const htmlOutput = renderToString(React.createElement(Component));
      expect(htmlOutput).toContain('<div>4</div>');
    });

    it('lowers 3-argument range(start, end, step) to static stepped sequence array', () => {
      const code = `
        import { LitElement, html } from 'lit';
        import { range } from 'lit/directives/range.js';
        export class RangeStepSequence extends LitElement {
          render() {
            const evens = range(0, 10, 2);
            return html\`<div>\${evens.join(',')}</div>\`;
          }
        }
      `;
      const res = compileModule(code, { filePath: 'range-step.ts' });
      expect(res.code).toMatch(/const evens = \[\s*0,\s*2,\s*4,\s*6,\s*8\s*\];/);

      const Component = evalComponent(res.code, 'RangeStepSequence');
      const htmlOutput = renderToString(React.createElement(Component));
      expect(htmlOutput).toContain('<div>0,2,4,6,8</div>');
    });
  });

  // =========================================================================
  // 10. Directive: live DOM property binding empirical stress testing
  // =========================================================================
  describe('10. Directive: live DOM property binding empirical stress testing', () => {
    it('lowers .value=${live(v)} to ref callback directly assigning to element.value', () => {
      const code = `
        import { LitElement, html } from 'lit';
        import { live } from 'lit/directives/live.js';
        export class LiveValueBinding extends LitElement {
          render() {
            const dynamicValue = 'Live synchronized text';
            return html\`<input .value=\${live(dynamicValue)} />\`;
          }
        }
      `;
      const res = compileModule(code, { filePath: 'live-val.ts' });
      expect(res.code).not.toContain('live(');
      expect(res.code).toContain('ref={(el) => {');
      expect(res.code).toContain('if (el) el.value = dynamicValue;');

      const Component = evalComponent(res.code, 'LiveValueBinding');
      const htmlOutput = renderToString(React.createElement(Component));
      expect(htmlOutput).toBe('<input/>');
    });

    it('lowers .checked=${live(b)} on checkbox to ref callback directly assigning element.checked', () => {
      const code = `
        import { LitElement, html } from 'lit';
        import { live } from 'lit/directives/live.js';
        export class LiveCheckedBinding extends LitElement {
          render() {
            const isChecked = true;
            return html\`<input type="checkbox" .checked=\${live(isChecked)} />\`;
          }
        }
      `;
      const res = compileModule(code, { filePath: 'live-checked.ts' });
      expect(res.code).toContain('if (el) el.checked = isChecked;');

      const Component = evalComponent(res.code, 'LiveCheckedBinding');
      const htmlOutput = renderToString(React.createElement(Component));
      expect(htmlOutput).toBe('<input type="checkbox"/>');
    });
  });

  // =========================================================================
  // 11. Directive: keyed association empirical stress testing
  // =========================================================================
  describe('11. Directive: keyed association empirical stress testing', () => {
    it('attaches static string key directly to root template element', () => {
      const code = `
        import { LitElement, html } from 'lit';
        import { keyed } from 'lit/directives/keyed.js';
        export class KeyedStatic extends LitElement {
          render() {
            return html\`
              <div class="wrap">
                \${keyed('profile-section', html\`<section class="profile">Profile details</section>\`)}
              </div>
            \`;
          }
        }
      `;
      const res = compileModule(code, { filePath: 'keyed-static.ts' });
      expect(res.code).not.toContain('keyed(');
      expect(res.code).toContain('key="profile-section"');

      const Component = evalComponent(res.code, 'KeyedStatic');
      const htmlOutput = renderToString(React.createElement(Component));
      expect(htmlOutput).toContain('<section class="profile">Profile details</section>');
    });

    it('attaches dynamic key expression directly to root template element', () => {
      const code = `
        import { LitElement, html } from 'lit';
        import { keyed } from 'lit/directives/keyed.js';
        export class KeyedDynamic extends LitElement {
          tab = 'settings';
          render() {
            return html\`
              <main>
                \${keyed(this.tab, html\`<article class="tab-pane">\${this.tab} view</article>\`)}
              </main>
            \`;
          }
        }
      `;
      const res = compileModule(code, { filePath: 'keyed-dynamic.ts', targetTier: 'Tier1Hosted' });
      expect(res.code).toContain('key={host.tab}');

      const Component = evalComponent(res.code, 'KeyedDynamic');
      const htmlOutput = renderToString(React.createElement(Component));
      expect(htmlOutput).toContain('tab-pane');
    });
  });

  // =========================================================================
  // 12. Directive: guard memoization unwrap empirical stress testing
  // =========================================================================
  describe('12. Directive: guard memoization unwrap empirical stress testing', () => {
    it('unwraps guarded template function directly into JSX tree', () => {
      const code = `
        import { LitElement, html } from 'lit';
        import { guard } from 'lit/directives/guard.js';
        export class GuardUnwrap extends LitElement {
          render() {
            const dependency = 'v1.0';
            return html\`
              <div class="wrapper">
                \${guard([dependency], () => html\`<div class="cached-block">Version: \${dependency}</div>\`)}
              </div>
            \`;
          }
        }
      `;
      const res = compileModule(code, { filePath: 'guard-unwrap.ts' });
      expect(res.code).not.toContain('guard(');
      expect(res.code).toContain('<div className="cached-block">');

      const Component = evalComponent(res.code, 'GuardUnwrap');
      const htmlOutput = renderToString(React.createElement(Component));
      expect(htmlOutput).toContain('cached-block');
      expect(htmlOutput).toContain('v1.0');
    });
  });

  // =========================================================================
  // 13. Directive: ref callback binding empirical stress testing
  // =========================================================================
  describe('13. Directive: ref callback binding empirical stress testing', () => {
    it('lowers ${ref(variable)} to ref={variable} on JSX element in Tier 0', () => {
      const code = `
        import { LitElement, html } from 'lit';
        import { ref } from 'lit/directives/ref.js';
        export class RefTier0 extends LitElement {
          render() {
            const elementRef = null;
            return html\`<button \${ref(elementRef)} class="btn">Action</button>\`;
          }
        }
      `;
      const res = compileModule(code, { filePath: 'ref-t0.ts' });
      expect(res.code).not.toContain('ref(');
      expect(res.code).toContain('ref={elementRef}');

      const Component = evalComponent(res.code, 'RefTier0');
      const htmlOutput = renderToString(React.createElement(Component));
      expect(htmlOutput).toContain('<button class="btn">Action</button>');
    });

    it('lowers ${ref(this.myRef)} to ref={host.myRef} on JSX element in Tier 1', () => {
      const code = `
        import { LitElement, html } from 'lit';
        import { ref } from 'lit/directives/ref.js';
        export class RefTier1 extends LitElement {
          buttonRef = null;
          render() {
            return html\`<button \${ref(this.buttonRef)}>Save</button>\`;
          }
        }
      `;
      const res = compileModule(code, { filePath: 'ref-t1.ts', targetTier: 'Tier1Hosted' });
      expect(res.code).toContain('ref={host.buttonRef}');
    });
  });

  // =========================================================================
  // 14. Directives: unsafeHTML and unsafeSVG empirical stress testing
  // =========================================================================
  describe('14. Directives: unsafeHTML and unsafeSVG empirical stress testing', () => {
    it('lowers unsafeHTML in sole-child position to dangerouslySetInnerHTML', () => {
      const code = `
        import { LitElement, html } from 'lit';
        import { unsafeHTML } from 'lit/directives/unsafe-html.js';
        export class UnsafeHtmlComp extends LitElement {
          render() {
            const rawMarkup = '<span class="highlight">Formatted <em>HTML</em></span>';
            return html\`<div class="rich-text">\${unsafeHTML(rawMarkup)}</div>\`;
          }
        }
      `;
      const res = compileModule(code, { filePath: 'unsafe-html.ts' });
      expect(res.code).not.toContain('unsafeHTML(');
      expect(res.code).toContain('dangerouslySetInnerHTML={{ __html: rawMarkup }}');

      const Component = evalComponent(res.code, 'UnsafeHtmlComp');
      const htmlOutput = renderToString(React.createElement(Component));
      expect(htmlOutput).toContain('<div class="rich-text"><span class="highlight">Formatted <em>HTML</em></span></div>');
    });

    it('lowers unsafeSVG in sole-child position to dangerouslySetInnerHTML on SVG container', () => {
      const code = `
        import { LitElement, html } from 'lit';
        import { unsafeSVG } from 'lit/directives/unsafe-svg.js';
        export class UnsafeSvgComp extends LitElement {
          render() {
            const rawSvg = '<circle cx="50" cy="50" r="40" stroke="green" stroke-width="4" fill="yellow" />';
            return html\`<svg viewBox="0 0 100 100" class="icon">\${unsafeSVG(rawSvg)}</svg>\`;
          }
        }
      `;
      const res = compileModule(code, { filePath: 'unsafe-svg.ts' });
      expect(res.code).not.toContain('unsafeSVG(');
      expect(res.code).toContain('dangerouslySetInnerHTML={{ __html: rawSvg }}');

      const Component = evalComponent(res.code, 'UnsafeSvgComp');
      const htmlOutput = renderToString(React.createElement(Component));
      expect(htmlOutput).toContain('<svg viewBox="0 0 100 100" class="icon"><circle cx="50" cy="50" r="40" stroke="green" stroke-width="4" fill="yellow" /></svg>');
    });

    it('documents caveat: unsafeHTML in non-sole-child position is left unlowered due to DOM collision', () => {
      const code = `
        import { LitElement, html } from 'lit';
        import { unsafeHTML } from 'lit/directives/unsafe-html.js';
        export class NonSoleChildUnsafe extends LitElement {
          render() {
            const raw = '<b>Bold</b>';
            return html\`<div class="wrap"><span>Prefix</span>\${unsafeHTML(raw)}</div>\`;
          }
        }
      `;
      const res = compileModule(code, { filePath: 'non-sole.ts' });
      // Non-sole child cannot use dangerouslySetInnerHTML on parent without blowing away sibling <span>
      expect(res.code).toContain('{unsafeHTML(raw)}');
    });
  });

  // =========================================================================
  // 15. Template ternary branch keying empirical stress testing
  // =========================================================================
  describe('15. Template ternary branch keying empirical stress testing', () => {
    it('injects distinct branch-0 and branch-1 keys on conditional template branches', () => {
      const code = `
        import { LitElement, html } from 'lit';
        export class TernaryBranches extends LitElement {
          render() {
            const isLogin = true;
            return html\`
              <div class="auth-box">
                \${isLogin
                  ? html\`<input id="email" placeholder="Login email" />\`
                  : html\`<input id="username" placeholder="Registration username" />\`}
              </div>
            \`;
          }
        }
      `;
      const res = compileModule(code, { filePath: 'ternary-branches.ts' });
      expect(res.code).toContain('key="branch-0"');
      expect(res.code).toContain('key="branch-1"');

      const Component = evalComponent(res.code, 'TernaryBranches');
      const htmlOutput = renderToString(React.createElement(Component));
      expect(htmlOutput).toContain('<input id="email" placeholder="Login email"/>');
    });

    it('injects branch-0 key when alternate branch is null or undefined', () => {
      const code = `
        import { LitElement, html } from 'lit';
        export class TernaryNullAlt extends LitElement {
          render() {
            const showBanner = true;
            return html\`
              <header>
                \${showBanner ? html\`<div class="banner">Announcement</div>\` : null}
              </header>
            \`;
          }
        }
      `;
      const res = compileModule(code, { filePath: 'ternary-null.ts' });
      expect(res.code).toContain('key="branch-0"');
      expect(res.code).toContain(': null');

      const Component = evalComponent(res.code, 'TernaryNullAlt');
      const htmlOutput = renderToString(React.createElement(Component));
      expect(htmlOutput).toContain('<div class="banner">Announcement</div>');
    });

    it('verifies nested ternary in alternate position is lowered to JSX', () => {
      const code = `
        import { LitElement, html } from 'lit';
        export class NestedTernaryBug extends LitElement {
          render() {
            const c1 = false;
            const c2 = true;
            return html\`
              <div>
                \${c1 ? html\`<span>A</span>\` : (c2 ? html\`<span>B</span>\` : html\`<span>C</span>\`)}
              </div>
            \`;
          }
        }
      `;
      const res = compileModule(code, { filePath: 'nested-ternary.ts' });
      expect(res.code).not.toContain('html`<span');
      expect(res.code).toContain('<span key="branch-0">B</span>');
      expect(res.code).toContain('<span key="branch-1">C</span>');
    });
  });

  // =========================================================================
  // 16. Static ID rewriting via useId() empirical stress testing
  // =========================================================================
  describe('16. Static ID rewriting via useId() empirical stress testing', () => {
    it('rewrites id and corresponding htmlFor and aria-describedby with _id prefix', () => {
      const code = `
        import { LitElement, html } from 'lit';
        export class FormFieldIsolation extends LitElement {
          render() {
            return html\`
              <div class="form-group">
                <label for="user-field">Username</label>
                <input id="user-field" aria-describedby="user-help" />
                <span id="user-help">Must be 4-16 characters</span>
              </div>
            \`;
          }
        }
      `;
      const res = compileModule(code, { filePath: 'form-field.ts' });
      expect(res.code).toContain('const _id = React.useId();');
      expect(res.code).toContain('htmlFor={_id + "-user-field"}');
      expect(res.code).toContain('id={_id + "-user-field"}');
      expect(res.code).toContain('aria-describedby={_id + "-user-help"}');

      const Component = evalComponent(res.code, 'FormFieldIsolation');

      // Render two instances within the same tree
      const combined = renderToString(React.createElement(React.Fragment, null, React.createElement(Component), React.createElement(Component)));

      const idMatches = Array.from(combined.matchAll(/id="([^"]+-user-field)"/g)).map((m) => m[1]);
      expect(idMatches).toHaveLength(2);
      // Instance 1 and Instance 2 must receive completely distinct instance IDs
      expect(idMatches[0]).not.toEqual(idMatches[1]);

      const forMatches = Array.from(combined.matchAll(/for="([^"]+-user-field)"/g)).map((m) => m[1]);
      expect(forMatches).toHaveLength(2);
      expect(forMatches[0]).toBe(idMatches[0]);
      expect(forMatches[1]).toBe(idMatches[1]);
    });

    it('preserves unreferenced local IDs (such as SVG gradients) without useId rewrite', () => {
      const code = `
        import { LitElement, html } from 'lit';
        export class SvgDefsIsolation extends LitElement {
          render() {
            return html\`
              <svg>
                <linearGradient id="gradient-accent"></linearGradient>
                <rect fill="url(#gradient-accent)" />
              </svg>
            \`;
          }
        }
      `;
      const res = compileModule(code, { filePath: 'svg-defs.ts' });
      // Gradient ID is not referenced by an HTML IDREF attribute, so it must not be mutated
      expect(res.code).not.toContain('_id + "-gradient-accent"');
      expect(res.code).toContain('id="gradient-accent"');
    });
  });

  // =========================================================================
  // 17. CustomEvent boundary stopping & tag suffix configuration stress testing
  // =========================================================================
  describe('17. CustomEvent boundary stopping & tag suffix configuration stress testing', () => {
    it('stops non-composed CustomEvents via stopNonComposedEvent utility', () => {
      let propagationStopped = false;
      const nonComposedEvent = {
        type: 'internal-boundary-event',
        composed: false,
        bubbles: true,
        stopPropagation: () => {
          propagationStopped = true;
        },
      } as unknown as Event;

      stopNonComposedEvent(nonComposedEvent);
      expect(propagationStopped).toBe(true);

      let composedStopped = false;
      const composedEvent = {
        type: 'public-event',
        composed: true,
        bubbles: true,
        stopPropagation: () => {
          composedStopped = true;
        },
      } as unknown as Event;

      stopNonComposedEvent(composedEvent);
      expect(composedStopped).toBe(false);
    });

    it('verifies toEventPropName converts custom and kebab-case event names accurately', () => {
      expect(toEventPropName('click')).toBe('onClick');
      expect(toEventPropName('cds-button-click')).toBe('onCdsButtonClick');
      expect(toEventPropName('sp-tab-change')).toBe('onSpTabChange');
      expect(toEventPropName('custom:action')).toBe('onCustomAction');
      expect(toEventPropName('under_score_event')).toBe('onUnderScoreEvent');
    });

    it('configures host element tag suffix (--suffix=-react) across compiler emission', () => {
      const code = `
        import { LitElement, html, property } from 'lit';
        export class MetricCard extends LitElement {
          @property({ type: String }) title = 'Metrics';
          render() {
            return html\`<div class="body">Card content</div>\`;
          }
        }
      `;
      const res = compileModule(code, {
        filePath: 'metric-card.ts',
        tagSuffix: '-react',
      });
      expect(res.tagName).toBe('metric-card-react');
      expect(res.tier).toBe('Tier1Hosted');
      expect(res.code).toContain('<metric-card-react');
      expect(res.code).toContain('</metric-card-react>');
    });
  });

  // =========================================================================
  // 18. Wave 2 adversarial remediation stress verification
  // =========================================================================
  describe('18. Wave 2 adversarial remediation stress verification', () => {
    it('empirically verifies 2-arg repeat with positional parameter binding in template expressions', () => {
      const code = `
        import { LitElement, html, property } from 'lit';
        import { repeat } from 'lit/directives/repeat.js';
        export class RepeatPosBinding extends LitElement {
          @property({ type: Array }) items = [];
          render() {
            return html\`
              <div class="list">
                \${repeat(this.items, (item, pos) => html\`
                  <span data-position=\${pos} data-item=\${item}>\${pos}: \${item}</span>
                \`)}
              </div>
            \`;
          }
        }
      `;
      const res = compileModule(code, { filePath: 'repeat-pos-binding.ts' });
      expect(res.code).toContain('key={pos}');
      expect(res.code).toContain('(item, pos)');
      expect(res.code).toContain('data-position={pos}');

      const Component = evalComponent(res.code, 'RepeatPosBinding');
      const htmlOutput = renderToString(React.createElement(Component, { items: ['Alpha', 'Beta', 'Gamma'] }));
      expect(htmlOutput).toContain('data-position="0"');
      expect(htmlOutput).toContain('data-position="1"');
      expect(htmlOutput).toContain('data-item="Alpha"');
      expect(htmlOutput).toContain('data-item="Beta"');
      expect(htmlOutput).toContain('data-item="Gamma"');
      expect(htmlOutput).toContain('0<!-- -->:');
      expect(htmlOutput).toContain('1<!-- -->:');
      expect(htmlOutput).toContain('2<!-- -->:');
    });

    it('empirically verifies 2-arg repeat with single parameter synthesizes index and avoids ReferenceError', () => {
      const code = `
        import { LitElement, html, property } from 'lit';
        import { repeat } from 'lit/directives/repeat.js';
        export class RepeatSingleParamSynthesized extends LitElement {
          @property({ type: Array }) items = [];
          render() {
            return html\`
              <ul>
                \${repeat(this.items, (item) => html\`
                  <li>\${item}</li>
                \`)}
              </ul>
            \`;
          }
        }
      `;
      const res = compileModule(code, { filePath: 'repeat-single-synthesized.ts' });
      expect(res.code).toContain('(item, index)');
      expect(res.code).toContain('key={index}');

      const Component = evalComponent(res.code, 'RepeatSingleParamSynthesized');
      const htmlOutput = renderToString(React.createElement(Component, { items: ['First', 'Second'] }));
      expect(htmlOutput).toContain('<li>First</li>');
      expect(htmlOutput).toContain('<li>Second</li>');
    });

    it('empirically verifies multi-arg range with negative step creates descending sequence', () => {
      const code = `
        import { LitElement, html } from 'lit';
        import { range } from 'lit/directives/range.js';
        export class RangeNegativeStep extends LitElement {
          render() {
            const countdown = range(5, 0, -1);
            return html\`<div class="countdown">\${countdown.join(' > ')}</div>\`;
          }
        }
      `;
      const res = compileModule(code, { filePath: 'range-neg-step.ts' });
      expect(res.code).toMatch(/const countdown = \[\s*5,\s*4,\s*3,\s*2,\s*1\s*\];/);

      const Component = evalComponent(res.code, 'RangeNegativeStep');
      const htmlOutput = renderToString(React.createElement(Component));
      expect(htmlOutput).toContain('5 &gt; 4 &gt; 3 &gt; 2 &gt; 1');
    });

    it('empirically verifies dynamic range in Tier 1 imports _range and computes sequence at runtime', () => {
      const code = `
        import { LitElement, html, property } from 'lit';
        import { range } from 'lit/directives/range.js';
        export class DynamicRangeHost extends LitElement {
          @property({ type: Number }) start = 2;
          @property({ type: Number }) end = 6;
          render() {
            const seq = range(this.start, this.end);
            return html\`<div>\${seq.join('-')}</div>\`;
          }
        }
      `;
      const res = compileModule(code, { filePath: 'dynamic-range-host.ts' });
      expect(res.code).toMatch(/import\s*\{[^}]*_range[^}]*\}\s*from\s*['"]@lit-core\/morph-to-react\/runtime['"]/);
      expect(res.code).toContain('_range(host.start, host.end)');

      const Component = evalComponent(res.code, 'DynamicRangeHost');
      const htmlOutput = renderToString(React.createElement(Component, { start: 10, end: 14 }));
      expect(htmlOutput).toContain('<div>10-11-12-13</div>');
    });

    it('empirically verifies dynamic range inside map directive imports _range and iterates items', () => {
      const code = `
        import { LitElement, html, property } from 'lit';
        import { map } from 'lit/directives/map.js';
        import { range } from 'lit/directives/range.js';
        export class DynamicRangeMapHost extends LitElement {
          @property({ type: Number }) count = 3;
          render() {
            return html\`
              <ol>
                \${map(range(this.count), (num) => html\`
                  <li>Item \${num}</li>
                \`)}
              </ol>
            \`;
          }
        }
      `;
      const res = compileModule(code, { filePath: 'dynamic-range-map.ts' });
      expect(res.code).toMatch(/import\s*\{[^}]*_range[^}]*\}\s*from\s*['"]@lit-core\/morph-to-react\/runtime['"]/);
      expect(res.code).toContain('_range(host.count).map(');

      const Component = evalComponent(res.code, 'DynamicRangeMapHost');
      const htmlOutput = renderToString(React.createElement(Component, { count: 3 }));
      expect(htmlOutput).toContain('Item<!-- --> <!-- -->0');
      expect(htmlOutput).toContain('Item<!-- --> <!-- -->1');
      expect(htmlOutput).toContain('Item<!-- --> <!-- -->2');
    });

    it('empirically verifies dynamic classMap in Tier 0 imports _classMap from runtime', () => {
      const code = `
        import { LitElement, html } from 'lit';
        import { classMap } from 'lit/directives/class-map.js';
        export class LeafBadge extends LitElement {
          render() {
            const dynamicClasses = { 'badge-active': true, 'badge-hidden': false };
            return html\`<span class=\${classMap(dynamicClasses)}>Online</span>\`;
          }
        }
      `;
      const res = compileModule(code, { filePath: 'leaf-badge.ts' });
      expect(res.tier).toBe('Tier0Pure');
      expect(res.code).toMatch(/import\s*\{[^}]*_classMap[^}]*\}\s*from\s*['"]@lit-core\/morph-to-react\/runtime['"]/);
      expect(res.code).toContain('className={_classMap(dynamicClasses)}');

      const Component = evalComponent(res.code, 'LeafBadge');
      const htmlOutput = renderToString(React.createElement(Component));
      expect(htmlOutput).toContain('class="badge-active"');
      expect(htmlOutput).not.toContain('badge-hidden');
      expect(htmlOutput).toContain('Online');
    });

    it('empirically verifies dynamic styleMap in Tier 0 imports _styleMap from runtime', () => {
      const code = `
        import { LitElement, html } from 'lit';
        import { styleMap } from 'lit/directives/style-map.js';
        export class LeafBox extends LitElement {
          render() {
            const dynamicStyles = { color: 'navy', 'font-weight': '600', '--box-padding': '16px' };
            return html\`<div style=\${styleMap(dynamicStyles)}>Header Box</div>\`;
          }
        }
      `;
      const res = compileModule(code, { filePath: 'leaf-box.ts' });
      expect(res.tier).toBe('Tier0Pure');
      expect(res.code).toMatch(/import\s*\{[^}]*_styleMap[^}]*\}\s*from\s*['"]@lit-core\/morph-to-react\/runtime['"]/);
      expect(res.code).toContain('style={_styleMap(dynamicStyles)}');

      const Component = evalComponent(res.code, 'LeafBox');
      const htmlOutput = renderToString(React.createElement(Component));
      expect(htmlOutput).toContain('color:navy');
      expect(htmlOutput).toContain('font-weight:600');
      expect(htmlOutput).toContain('--box-padding:16px');
      expect(htmlOutput).toContain('Header Box');
    });

    it('empirically verifies combined component importing _classMap, _styleMap, and _range simultaneously', () => {
      const code = `
        import { LitElement, html, property } from 'lit';
        import { classMap } from 'lit/directives/class-map.js';
        import { styleMap } from 'lit/directives/style-map.js';
        import { range } from 'lit/directives/range.js';
        import { repeat } from 'lit/directives/repeat.js';

        export class MultiDirectiveHost extends LitElement {
          @property({ type: Object }) dynamicClasses = {};
          @property({ type: Object }) dynamicStyles = {};
          @property({ type: Number }) count = 3;

          render() {
            const items = range(this.count);
            return html\`
              <div class=\${classMap(this.dynamicClasses)} style=\${styleMap(this.dynamicStyles)}>
                \${repeat(items, (item, index) => html\`
                  <span data-idx=\${index}>Item \${item}</span>
                \`)}
              </div>
            \`;
          }
        }
      `;
      const res = compileModule(code, { filePath: 'multi-directive-host.ts' });
      expect(res.code).toMatch(/import\s*\{[^}]*_classMap[^}]*\}\s*from\s*['"]@lit-core\/morph-to-react\/runtime['"]/);
      expect(res.code).toMatch(/import\s*\{[^}]*_styleMap[^}]*\}\s*from\s*['"]@lit-core\/morph-to-react\/runtime['"]/);
      expect(res.code).toMatch(/import\s*\{[^}]*_range[^}]*\}\s*from\s*['"]@lit-core\/morph-to-react\/runtime['"]/);

      const Component = evalComponent(res.code, 'MultiDirectiveHost');
      const htmlOutput = renderToString(
        React.createElement(Component, {
          dynamicClasses: { 'multi-active': true },
          dynamicStyles: { 'border-width': '2px', '--brand': '#10b981' },
          count: 3,
        }),
      );
      expect(htmlOutput).toContain('class="multi-active"');
      expect(htmlOutput).toContain('border-width:2px');
      expect(htmlOutput).toContain('--brand:#10b981');
      expect(htmlOutput).toContain('data-idx="0"');
      expect(htmlOutput).toContain('data-idx="1"');
      expect(htmlOutput).toContain('data-idx="2"');
    });
  });
});
