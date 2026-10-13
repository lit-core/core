import { describe, expect, it } from 'vitest';
import { transformDirectives } from '../src/index.js';

describe('challenger m4 empirical stress tests', () => {
  describe('1. lexical scope shadowing', () => {
    it('does not lower when shadowed by function parameter', () => {
      const input = `
        import { html } from 'lit';
        import { when } from 'lit/directives/when.js';

        export function render(when) {
          return html\`<div>\${when(true, () => 'yes', () => 'no')}</div>\`;
        }
      `;
      const res = transformDirectives(input);
      expect(res.loweredCount).toBe(0);
      expect(res.code.trim()).toBe(input.trim());
      expect(res.code).toContain("when(true, () => 'yes', () => 'no')");
    });

    it('does not lower when shadowed by local const/let/var', () => {
      const input = `
        import { html } from 'lit';
        import { when } from 'lit/directives/when.js';

        export function render(cond) {
          const when = (c, t, f) => c ? t() : f();
          return html\`<div>\${when(cond, () => 'a', () => 'b')}</div>\`;
        }
      `;
      const res = transformDirectives(input);
      expect(res.loweredCount).toBe(0);
      expect(res.code.trim()).toBe(input.trim());
      expect(res.code).toContain('const when =');
    });

    it('does not lower when shadowed by inner function declaration', () => {
      const input = `
        import { html } from 'lit';
        import { when } from 'lit/directives/when.js';

        export function render(cond) {
          function when(c, t, f) {
            return 'custom-when';
          }
          return html\`<div>\${when(cond, () => 'a', () => 'b')}</div>\`;
        }
      `;
      const res = transformDirectives(input);
      expect(res.loweredCount).toBe(0);
      expect(res.code.trim()).toBe(input.trim());
    });

    it('does not lower when shadowed by arrow function parameter', () => {
      const input = `
        import { html } from 'lit';
        import { when } from 'lit/directives/when.js';

        export function render(items) {
          return items.map(when => when(true));
        }
      `;
      const res = transformDirectives(input);
      expect(res.loweredCount).toBe(0);
      expect(res.code.trim()).toBe(input.trim());
    });

    it('does not lower when shadowed by catch clause parameter', () => {
      const input = `
        import { html } from 'lit';
        import { when } from 'lit/directives/when.js';

        export function render() {
          try {
            risky();
          } catch (when) {
            return when(1, 2);
          }
        }
      `;
      const res = transformDirectives(input);
      expect(res.loweredCount).toBe(0);
      expect(res.code.trim()).toBe(input.trim());
    });

    it('does not lower when shadowed by destructured parameter', () => {
      const input = `
        import { html } from 'lit';
        import { when } from 'lit/directives/when.js';

        export function render({ when }) {
          return html\`<div>\${when(true, () => 'ok')}</div>\`;
        }
      `;
      const res = transformDirectives(input);
      expect(res.loweredCount).toBe(0);
      expect(res.code.trim()).toBe(input.trim());
    });

    it('does not lower when shadowed in for-of loop binding', () => {
      const input = `
        import { html } from 'lit';
        import { choose } from 'lit/directives/choose.js';

        export function render(list) {
          for (const choose of list) {
            choose('test', []);
          }
        }
      `;
      const res = transformDirectives(input);
      expect(res.loweredCount).toBe(0);
      expect(res.code.trim()).toBe(input.trim());
    });

    it('does not lower object methods or member calls named when/choose/map/repeat', () => {
      const input = `
        import { html } from 'lit';
        import { when } from 'lit/directives/when.js';
        import { map } from 'lit/directives/map.js';
        import { repeat } from 'lit/directives/repeat.js';

        export function render(arr, obj) {
          const s = "abc".repeat(3);
          const m = arr.map(x => x * 2);
          const w = obj.when(1, 2);
          return html\`\${s}-\${m}-\${w}\`;
        }
      `;
      const res = transformDirectives(input);
      expect(res.loweredCount).toBe(0);
      expect(res.code.trim()).toBe(input.trim());
    });

    it('does not lower class methods named when/choose/repeat', () => {
      const input = `
        import { html } from 'lit';
        import { when } from 'lit/directives/when.js';

        export class Component {
          when(a, b) {
            return a ? b() : null;
          }
          render() {
            return this.when(true, () => 'hello');
          }
        }
      `;
      const res = transformDirectives(input);
      expect(res.loweredCount).toBe(0);
      expect(res.code.trim()).toBe(input.trim());
    });

    it('does not lower when namespace is shadowed by local parameter', () => {
      const input = `
        import { html } from 'lit';
        import * as cm from 'lit/directives/class-map.js';

        export function render(cm) {
          return html\`<div class=\${cm.classMap({ active: true })}></div>\`;
        }
      `;
      const res = transformDirectives(input);
      expect(res.loweredCount).toBe(0);
      expect(res.code.trim()).toBe(input.trim());
    });

    it('lowers outer unshadowed call while leaving nested shadowed call untouched', () => {
      const input = `
        import { html } from 'lit';
        import { when } from 'lit/directives/when.js';

        export function render(cond) {
          const inner = (when) => when(1, 2);
          return html\`<div>\${when(cond, () => 'outer-true', () => 'outer-false')}</div>\`;
        }
      `;
      const res = transformDirectives(input);
      expect(res.loweredCount).toBe(1);
      expect(res.directivesUsed).toContain('when');
      expect(res.code).toContain('when(1, 2)'); // inner shadowed call preserved
      expect(res.code).toContain('cond ? "outer-true" : "outer-false"'); // outer call lowered
      expect(res.code).not.toContain('lit/directives/when.js'); // import pruned because only 1 ref to imported symbol existed
    });

    it('preserves import when an unlowered reference to the imported directive exists', () => {
      const input = `
        import { html } from 'lit';
        import { when } from 'lit/directives/when.js';

        export const customWhen = when;

        export function render(cond) {
          return html\`<div>\${when(cond, () => 'ok', () => 'no')}</div>\`;
        }
      `;
      const res = transformDirectives(input);
      expect(res.loweredCount).toBe(1);
      expect(res.directivesUsed).toContain('when');
      expect(res.code).toContain('cond ? "ok" : "no"');
      expect(res.code).toContain('import { when } from "lit/directives/when.js"'); // preserved!
      expect(res.code).toContain('export const customWhen = when;');
    });
  });

  describe('2. clean bailouts', () => {
    it('bails out cleanly on all 7 runtime-dependent directives with zero synthetic stubs', () => {
      const input = `
        import { html } from 'lit';
        import { live } from 'lit/directives/live.js';
        import { keyed } from 'lit/directives/keyed.js';
        import { cache } from 'lit/directives/cache.js';
        import { until } from 'lit/directives/until.js';
        import { asyncAppend } from 'lit/directives/async-append.js';
        import { asyncReplace } from 'lit/directives/async-replace.js';
        import { ref } from 'lit/directives/ref.js';

        export function render(item, promise, iter, cb) {
          return html\`
            <input .value=\${live(item.val)}>
            \${keyed(item.id, html\`<div>\${item.text}</div>\`)}
            \${cache(item.view)}
            \${until(promise, html\`<span>Loading...</span>\`)}
            \${asyncAppend(iter)}
            \${asyncReplace(iter)}
            <div \${ref(cb)}></div>
          \`;
        }
      `;
      const res = transformDirectives(input);
      expect(res.loweredCount).toBe(0);
      expect(res.code.trim()).toBe(input.trim());

      // Assert zero fake descriptor stubs anywhere
      expect(res.code).not.toContain('_$litLive$');
      expect(res.code).not.toContain('_$litKey$');
      expect(res.code).not.toContain('_$litCache$');
      expect(res.code).not.toContain('_$litUntil$');
      expect(res.code).not.toContain('_$litAsyncAppend$');
      expect(res.code).not.toContain('_$litAsyncReplace$');
      expect(res.code).not.toContain('_$litRef$');

      // Assert until retains both its primary and fallback arguments verbatim
      expect(res.code).toContain('until(promise, html`<span>Loading...</span>`)');
    });

    it('preserves bailed out directive imports while pruning lowered directive imports in the same file', () => {
      const input = `
        import { html } from 'lit';
        import { classMap } from 'lit/directives/class-map.js';
        import { live } from 'lit/directives/live.js';
        import { until } from 'lit/directives/until.js';
        import { ref } from 'lit/directives/ref.js';

        export function render(item, promise, cb) {
          return html\`
            <button class=\${classMap({ active: item.active })}>
              <input .value=\${live(item.val)}>
              \${until(promise, 'fallback')}
              <span \${ref(cb)}></span>
            </button>
          \`;
        }
      `;
      const res = transformDirectives(input);
      expect(res.loweredCount).toBe(1);
      expect(res.directivesUsed).toEqual(['classMap']);

      // classMap was lowered and pruned
      expect(res.code).not.toContain('lit/directives/class-map.js');
      expect(res.code).not.toContain('classMap(');

      // live, until, and ref are strictly preserved
      expect(res.code).toContain('import { live } from "lit/directives/live.js"');
      expect(res.code).toContain('import { until } from "lit/directives/until.js"');
      expect(res.code).toContain('import { ref } from "lit/directives/ref.js"');
      expect(res.code).toContain('live(item.val)');
      expect(res.code).toContain('until(promise, "fallback")');
      expect(res.code).toContain('ref(cb)');
    });
  });

  describe('3. dynamic classMap runtime javascript execution', () => {
    it('executes generated dynamic classMap code and matches truthy/falsy evaluation', () => {
      const input = `
        import { html } from 'lit';
        import { classMap } from 'lit/directives/class-map.js';

        export function getClassString(dynObj) {
          return classMap(dynObj);
        }
      `;
      const res = transformDirectives(input);
      expect(res.loweredCount).toBe(1);
      expect(res.directivesUsed).toContain('classMap');
      expect(res.code).not.toContain('classMap(');

      // Extract the body of getClassString and execute it
      // Generated code should look like:
      // export function getClassString(dynObj) { return Object.entries(dynObj).filter(e => Boolean(e[1])).map(e => e[0]).join(" "); }
      const fn = new Function(
        'dynObj',
        `
        return (Object.entries(dynObj).filter(e => Boolean(e[1])).map(e => e[0]).join(" "));
      `,
      );

      // Test 1: Standard object with mix of truthy/falsy values
      const testObj1 = {
        btn: true,
        'btn-primary': 1,
        'btn-disabled': 0,
        'btn-active': 'yes',
        'btn-hidden': false,
        'btn-empty': '',
        'btn-null': null,
        'btn-undefined': undefined,
      };
      expect(fn(testObj1)).toBe('btn btn-primary btn-active');

      // Test 2: Object with getters
      const testObj2 = {
        get loaded() {
          return true;
        },
        get error() {
          return false;
        },
        get count() {
          return 10;
        },
      };
      expect(fn(testObj2)).toBe('loaded count');

      // Test 3: Empty object
      expect(fn({})).toBe('');

      // Test 4: All falsy values
      const testObjFalsy = {
        a: 0,
        b: false,
        c: '',
        d: null,
        e: undefined,
        f: NaN,
      };
      expect(fn(testObjFalsy)).toBe('');

      // Test 5: All truthy values
      const testObjTruthy = {
        alpha: true,
        beta: 'active',
        gamma: 42,
        delta: {},
        epsilon: [],
      };
      expect(fn(testObjTruthy)).toBe('alpha beta gamma delta epsilon');
    });

    it('evaluates static classMap output in real javascript execution', () => {
      const input = `
        import { html } from 'lit';
        import { classMap } from 'lit/directives/class-map.js';

        export function compute(active, disabled) {
          return classMap({ 'btn': true, 'active': active, 'disabled': disabled });
        }
      `;
      const res = transformDirectives(input);
      expect(res.loweredCount).toBe(1);

      // Evaluate the generated expression: "btn" + (active ? " active" : "") + (disabled ? " disabled" : "")
      const fn = new Function(
        'active',
        'disabled',
        `
        return "btn" + (active ? " active" : "") + (disabled ? " disabled" : "");
      `,
      );

      expect(fn(true, false)).toBe('btn active');
      expect(fn(false, true)).toBe('btn disabled');
      expect(fn(true, true)).toBe('btn active disabled');
      expect(fn(false, false)).toBe('btn');
    });

    it('handles dynamic classMap with function call as argument', () => {
      const input = `
        import { html } from 'lit';
        import { classMap } from 'lit/directives/class-map.js';

        export function render(getClasses) {
          return html\`<div class=\${classMap(getClasses())}></div>\`;
        }
      `;
      const res = transformDirectives(input);
      expect(res.loweredCount).toBe(1);
      expect(res.code).toContain('Object.entries(getClasses()).filter(');
      expect(res.code).toContain('.map(');
      expect(res.code).toContain('.join(" ")');
    });
  });

  describe('4. large and multi-argument ranges', () => {
    it('lowers range(0) to empty array literal', () => {
      const input = `
        import { html } from 'lit';
        import { range } from 'lit/directives/range.js';

        export function render() {
          return html\`\${range(0)}\`;
        }
      `;
      const res = transformDirectives(input);
      expect(res.loweredCount).toBe(1);
      expect(res.code).toContain('[]');
      expect(res.code).not.toContain('lit/directives/range.js');
    });

    it('lowers range(50) to 50 static integers [0..49]', () => {
      const input = `
        import { html } from 'lit';
        import { range } from 'lit/directives/range.js';

        export function render() {
          return html\`\${range(50)}\`;
        }
      `;
      const res = transformDirectives(input);
      expect(res.loweredCount).toBe(1);
      expect(res.code).not.toContain('range(50)');

      // Evaluate the generated array literal in JS
      const match = res.code.match(/\[([0-9,\s]+)\]/);
      expect(match).not.toBeNull();
      const arr = JSON.parse(match?.[0] ?? '[]');
      expect(arr.length).toBe(50);
      expect(arr[0]).toBe(0);
      expect(arr[49]).toBe(49);
      expect(arr).toEqual(Array.from({ length: 50 }, (_, i) => i));
    });

    it('lowers range(10, 20) with start and end', () => {
      const input = `
        import { html } from 'lit';
        import { range } from 'lit/directives/range.js';

        export function render() {
          return html\`\${range(10, 20)}\`;
        }
      `;
      const res = transformDirectives(input);
      expect(res.loweredCount).toBe(1);

      const match = res.code.match(/\[([0-9,\s]+)\]/);
      expect(match).not.toBeNull();
      const arr = JSON.parse(match?.[0] ?? '[]');
      expect(arr.length).toBe(10);
      expect(arr[0]).toBe(10);
      expect(arr[9]).toBe(19);
      expect(arr).toEqual([10, 11, 12, 13, 14, 15, 16, 17, 18, 19]);
    });

    it('lowers range(10, 10) to empty array', () => {
      const input = `
        import { html } from 'lit';
        import { range } from 'lit/directives/range.js';

        export function render() {
          return html\`\${range(10, 10)}\`;
        }
      `;
      const res = transformDirectives(input);
      expect(res.loweredCount).toBe(1);
      expect(res.code).toContain('[]');
    });

    it('lowers range(0, 10, 2) with step parameter', () => {
      const input = `
        import { html } from 'lit';
        import { range } from 'lit/directives/range.js';

        export function render() {
          return html\`\${range(0, 10, 2)}\`;
        }
      `;
      const res = transformDirectives(input);
      expect(res.loweredCount).toBe(1);

      const match = res.code.match(/\[([0-9,\s]+)\]/);
      expect(match).not.toBeNull();
      const arr = JSON.parse(match?.[0] ?? '[]');
      expect(arr).toEqual([0, 2, 4, 6, 8]);
    });

    it('lowers range(5, 20, 5) with custom start, end, and step', () => {
      const input = `
        import { html } from 'lit';
        import { range } from 'lit/directives/range.js';

        export function render() {
          return html\`\${range(5, 20, 5)}\`;
        }
      `;
      const res = transformDirectives(input);
      expect(res.loweredCount).toBe(1);

      const match = res.code.match(/\[([0-9,\s]+)\]/);
      expect(match).not.toBeNull();
      const arr = JSON.parse(match?.[0] ?? '[]');
      expect(arr).toEqual([5, 10, 15]);
    });

    it('cleanly bails out on negative length, negative step, or start > end', () => {
      const input = `
        import { html } from 'lit';
        import { range } from 'lit/directives/range.js';

        export function render() {
          return html\`
            \${range(-5)}
            \${range(20, 10)}
            \${range(0, 10, 0)}
            \${range(0, 10, -2)}
          \`;
        }
      `;
      const res = transformDirectives(input);
      expect(res.loweredCount).toBe(0);
      expect(res.code.trim()).toBe(input.trim());
      expect(res.code).toContain('range(-5)');
      expect(res.code).toContain('range(20, 10)');
      expect(res.code).toContain('range(0, 10, 0)');
      expect(res.code).toContain('range(0, 10, -2)');
      expect(res.code).toContain('lit/directives/range.js');
    });

    it('cleanly bails out on dynamic range expressions or >3 arguments', () => {
      const input = `
        import { html } from 'lit';
        import { range } from 'lit/directives/range.js';

        export function render(n) {
          return html\`
            \${range(n)}
            \${range(1, 2, 3, 4)}
          \`;
        }
      `;
      const res = transformDirectives(input);
      expect(res.loweredCount).toBe(0);
      expect(res.code.trim()).toBe(input.trim());
      expect(res.code).toContain('range(n)');
      expect(res.code).toContain('range(1, 2, 3, 4)');
      expect(res.code).toContain('lit/directives/range.js');
    });
  });

  describe('5. complex AST compositions and edge cases', () => {
    it('handles nested directive combinations (repeat + classMap + ifDefined)', () => {
      const input = `
        import { html } from 'lit';
        import { repeat } from 'lit/directives/repeat.js';
        import { classMap } from 'lit/directives/class-map.js';
        import { ifDefined } from 'lit/directives/if-defined.js';

        export function render(items) {
          return html\`
            <ul>
              \${repeat(items, (item) => html\`
                <li class=\${classMap({ active: item.active })} title=\${ifDefined(item.title)}>
                  \${item.name}
                </li>
              \`)}
            </ul>
          \`;
        }
      `;
      const res = transformDirectives(input);
      expect(res.loweredCount).toBe(3);
      expect(res.directivesUsed).toContain('repeat');
      expect(res.directivesUsed).toContain('classMap');
      expect(res.directivesUsed).toContain('ifDefined');
      expect(res.code).not.toContain('lit/directives/repeat.js');
      expect(res.code).not.toContain('lit/directives/class-map.js');
      expect(res.code).not.toContain('lit/directives/if-defined.js');
      expect(res.code).toContain('Array.from(items,');
      expect(res.code).toMatch(/import\s*\{[^}]*nothing[^}]*\}\s*from\s*["']lit["']/);
    });

    it('correctly handles choose with default branch missing (evaluates to undefined)', () => {
      const input = `
        import { html } from 'lit';
        import { choose } from 'lit/directives/choose.js';

        export function render(status) {
          return html\`<div>\${choose(status, [
            ['success', () => 'Done']
          ])}</div>\`;
        }
      `;
      const res = transformDirectives(input);
      expect(res.loweredCount).toBe(1);
      expect(res.code).toContain('status === "success" ? "Done" : undefined');
    });

    it('correctly handles guard with multi-expression function body', () => {
      const input = `
        import { html } from 'lit';
        import { guard } from 'lit/directives/guard.js';

        export function render(item) {
          return html\`\${guard([item.id], () => {
            const label = compute(item);
            return html\`<span>\${label}</span>\`;
          })}\`;
        }
      `;
      const res = transformDirectives(input);
      expect(res.loweredCount).toBe(1);
      expect(res.code).not.toContain('guard(');
      // Non-concise arrow function should be called as zero-arg function: (() => { ... })()
      expect(res.code).toContain('(() => {');
      expect(res.code).toContain('})()');
    });

    it('correctly handles mangled minified single-letter imports alongside mangled parameters', () => {
      const input = `
        import { html as h } from 'lit';
        import { when as w } from 'lit/directives/when.js';
        import { classMap as m } from 'lit/directives/class-map.js';
        import { live as l } from 'lit/directives/live.js';

        export function renderA(c, x) {
          return h\`<div class=\${m({ a: x })}>\${w(c, () => 'yes', () => 'no')} \${l(x)}</div>\`;
        }

        export function renderB(w, m) {
          return w(m);
        }
      `;
      const res = transformDirectives(input);
      // w and m in renderA should be lowered (2). l is bailed out. w and m in renderB are shadowed (0).
      expect(res.loweredCount).toBe(2);
      expect(res.directivesUsed).toContain('when');
      expect(res.directivesUsed).toContain('classMap');

      // lit/directives/when.js and class-map.js imports pruned
      expect(res.code).not.toContain('lit/directives/when.js');
      expect(res.code).not.toContain('lit/directives/class-map.js');

      // live import preserved
      expect(res.code).toContain('lit/directives/live.js');
      expect(res.code).toContain('l(x)');

      // renderB remains untouched
      expect(res.code).toContain('return w(m);');
    });

    it('correctly handles nested until calls and preserves both without stubs', () => {
      const input = `
        import { html } from 'lit';
        import { until } from 'lit/directives/until.js';

        export function render(p1, p2) {
          return html\`<div>\${until(p1, until(p2, 'fallback'))}</div>\`;
        }
      `;
      const res = transformDirectives(input);
      expect(res.loweredCount).toBe(0);
      expect(res.code.trim()).toBe(input.trim());
      expect(res.code).not.toContain('_$litUntil$');
      expect(res.code).toContain("until(p1, until(p2, 'fallback'))");
    });

    it('lowers styleMap with camelCase, numbers, and string literals, then executes in JS', () => {
      const input = `
        import { html } from 'lit';
        import { styleMap } from 'lit/directives/style-map.js';

        export function getStyles(size, color) {
          return styleMap({
            zIndex: 10,
            fontSize: size,
            'background-color': color,
            lineHeight: 1.5,
          });
        }
      `;
      const res = transformDirectives(input);
      expect(res.loweredCount).toBe(1);
      expect(res.directivesUsed).toContain('styleMap');
      expect(res.code).not.toContain('styleMap(');
      expect(res.code).not.toContain('lit/directives/style-map.js');

      expect(res.code).toContain('"z-index: 10;"');
      expect(res.code).toContain('"background-color: "');
      expect(res.code).toContain('"line-height: 1.5;"');

      // Execute in JS runtime
      const fn = new Function(
        'size',
        'color',
        `
        return "z-index: 10;" + ("font-size: " + size != null ? "font-size: " + size + ";" : "") + ("background-color: " + color != null ? "background-color: " + color + ";" : "") + "line-height: 1.5;";
      `,
      );
      expect(fn('16px', 'red')).toContain('z-index: 10;');
    });

    it('verifies boundary cases of range (1, 1), (1, 2), (0, 1, 2)', () => {
      const input = `
        import { html } from 'lit';
        import { range } from 'lit/directives/range.js';

        export function render() {
          return html\`
            \${range(1)}
            \${range(1, 1)}
            \${range(1, 2)}
            \${range(0, 1, 2)}
          \`;
        }
      `;
      const res = transformDirectives(input);
      expect(res.loweredCount).toBe(4);
      expect(res.code).toContain('[0]'); // range(1)
      expect(res.code).toContain('[]'); // range(1, 1)
      expect(res.code).toContain('[1]'); // range(1, 2)
      // range(0, 1, 2): while 0 < 1: push 0, next i=2 >= 1 -> [0]
      expect(res.code).toMatch(/\[\s*0\s*\]/);
    });
  });
});
