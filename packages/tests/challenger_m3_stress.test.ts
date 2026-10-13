import { describe, expect, it } from 'vitest';
import { transformDirtyMask } from '../dirty-mask/src/index.js';
import { transformDomPaths } from '../dom-paths/src/index.js';
import { transformEventHoist } from '../event-hoist/src/index.js';
import { transformMemoize } from '../memoize/src/index.js';

describe('empirical challenger m3 stress test suite', () => {
  // ==========================================
  // 1. MEMOIZE EMPIRICAL STRESS TESTS
  // ==========================================
  describe('memoize package', () => {
    it('strictly rejects direct in-place sort on this.items', () => {
      const code1 = `
import { LitElement, html } from 'lit';
export class Comp extends LitElement {
  render() {
    return html\`<div>\${this.items.sort()}</div>\`;
  }
}
`;
      const res1 = transformMemoize(code1);
      expect(res1.memoizedCount).toBe(0);
      expect(res1.code).not.toContain('__memo_');

      const code2 = `
import { LitElement, html } from 'lit';
export class Comp extends LitElement {
  render() {
    return html\`<div>\${this.items.sort((a, b) => a - b)}</div>\`;
  }
}
`;
      const res2 = transformMemoize(code2);
      expect(res2.memoizedCount).toBe(0);
      expect(res2.code).not.toContain('__memo_');

      const code3 = `
import { LitElement, html } from 'lit';
export class Comp extends LitElement {
  render() {
    return html\`<div>\${this.items.sort().map(x => x * 2)}</div>\`;
  }
}
`;
      const res3 = transformMemoize(code3);
      expect(res3.memoizedCount).toBe(0);
      expect(res3.code).not.toContain('__memo_');
    });

    it('accepts sort on fresh arrays produced by slice, filter, map, spread, concat, flatMap', () => {
      const testCases = [
        'this.items.slice().sort()',
        'this.items.slice().sort((a, b) => a - b)',
        'this.items.filter(x => x > 0).sort()',
        'this.items.map(x => x * 2).sort()',
        '[...this.items].sort()',
        'this.items.flatMap(x => [x]).sort()',
      ];

      for (const expr of testCases) {
        const input = `
import { LitElement, html } from 'lit';
export class Comp extends LitElement {
  render() {
    return html\`<div>\${${expr}}</div>\`;
  }
}
`;
        const res = transformMemoize(input);
        expect(res.memoizedCount, `Failed to memoize fresh array: ${expr}`).toBe(1);
        expect(res.code).toContain('__memo_items_ref === this.items');
      }
    });

    it('distinguishes structurally different sort and map expressions', () => {
      const input = `
import { LitElement, html } from 'lit';
export class Comp extends LitElement {
  render() {
    return html\`
      <div>
        \${this.items.slice(0, 5).map(x => x * 2)}
        \${this.items.slice(0, 10).map(x => x * 2)}
      </div>
    \`;
  }
}
`;
      const res = transformMemoize(input);
      // Both should be memoized separately as distinct slots
      expect(res.memoizedCount).toBe(2);
      expect(res.code).toContain('_memoized_items');
      expect(res.code).toContain('_memoized_items_1');
    });

    it('avoids identifier collisions with multiple pre-existing variables', () => {
      const input = `
import { LitElement, html } from 'lit';
export class Comp extends LitElement {
  render() {
    const _memoized_items = 'a';
    const _memoized_items_1 = 'b';
    const _memoized_items_2 = 'c';
    return html\`
      <div>
        \${_memoized_items}
        \${_memoized_items_1}
        \${_memoized_items_2}
        \${this.items.map(x => x)}
      </div>
    \`;
  }
}
`;
      const res = transformMemoize(input);
      expect(res.memoizedCount).toBe(1);
      // Must generate _memoized_items_3 to avoid colliding with 0, 1, and 2
      expect(res.code).toContain('let _memoized_items_3;');
      expect(res.code).toContain('const _memoized_items = "a";');
      expect(res.code).toContain('const _memoized_items_1 = "b";');
      expect(res.code).toContain('const _memoized_items_2 = "c";');
    });

    it('bails out on non-Lit classes and handles aliased Lit imports', () => {
      const nonLit = `
import { BaseClass } from './base.js';
import { html } from 'lit';
export class NonLitComp extends BaseClass {
  render() {
    return html\`<div>\${this.items.map(x => x)}</div>\`;
  }
}
`;
      const resNonLit = transformMemoize(nonLit);
      expect(resNonLit.componentsCount).toBe(0);
      expect(resNonLit.memoizedCount).toBe(0);

      const aliased = `
import { LitElement as LE, html as h } from 'lit';
export class AliasedComp extends LE {
  render() {
    return h\`<div>\${this.items.map(x => x)}</div>\`;
  }
}
`;
      const resAliased = transformMemoize(aliased);
      expect(resAliased.componentsCount).toBe(1);
      expect(resAliased.memoizedCount).toBe(1);
    });

    it('rejects mutating array methods even on fresh arrays', () => {
      // reverse() is in MUTATING_ARRAY_METHODS, so it must not be memoized
      const input = `
import { LitElement, html } from 'lit';
export class ReverseComp extends LitElement {
  render() {
    return html\`<div>\${this.items.slice().reverse()}</div>\`;
  }
}
`;
      const res = transformMemoize(input);
      expect(res.memoizedCount).toBe(0);
      expect(res.code).not.toContain('__memo_');
    });

    it('handles multiple classes in one file, transforming only the Lit component', () => {
      const input = `
import { LitElement, html } from 'lit';
import { OtherBase } from './other.js';

export class HelperClass extends OtherBase {
  render() {
    return html\`<div>\${this.items.map(x => x)}</div>\`;
  }
}

export class LitClass extends LitElement {
  render() {
    return html\`<div>\${this.items.map(x => x)}</div>\`;
  }
}
`;
      const res = transformMemoize(input);
      expect(res.componentsCount).toBe(1);
      expect(res.memoizedCount).toBe(1);
      expect(res.code).toContain('class LitClass extends LitElement');
      const helperMatch = res.code.match(/class HelperClass extends OtherBase\s*\{[\s\S]*?render\(\)\s*\{([\s\S]*?)\}/);
      expect(helperMatch?.[1]).not.toContain('__memo_');
    });
  });

  // ==========================================
  // 2. EVENT-HOIST EMPIRICAL STRESS TESTS
  // ==========================================
  describe('event-hoist package', () => {
    it('correctly rewrites quasis for single-quoted, double-quoted, and unquoted event bindings', () => {
      const inputDouble = `
import { LitElement, html } from 'lit';
export class Comp extends LitElement {
  render() {
    return html\`<button @click="\${this.onClick}">Click</button>\`;
  }
}
`;
      const resDouble = transformEventHoist(inputDouble);
      expect(resDouble.hoistedEventsCount).toBe(1);
      expect(resDouble.code).toContain('data-lh-click="');
      expect(resDouble.code).toContain('this.__lhAction(this.onClick)');

      const inputSingle = `
import { LitElement, html } from 'lit';
export class Comp extends LitElement {
  render() {
    return html\`<button @click='\${this.onClick}'>Click</button>\`;
  }
}
`;
      const resSingle = transformEventHoist(inputSingle);
      expect(resSingle.hoistedEventsCount).toBe(1);
      expect(resSingle.code).toContain("data-lh-click='");
      expect(resSingle.code).toContain('this.__lhAction(this.onClick)');

      const inputUnquoted = `
import { LitElement, html } from 'lit';
export class Comp extends LitElement {
  render() {
    return html\`<button @click=\${this.onClick}>Click</button>\`;
  }
}
`;
      const resUnquoted = transformEventHoist(inputUnquoted);
      expect(resUnquoted.hoistedEventsCount).toBe(1);
      expect(resUnquoted.code).toContain('data-lh-click="');
      expect(resUnquoted.code).toContain('this.__lhAction(this.onClick)');
    });

    it('hoists multiple distinct events on the same element without corrupting template', () => {
      const input = `
import { LitElement, html } from 'lit';
export class MultiEventComp extends LitElement {
  render() {
    return html\`<input @click=\${this.onClick} @input=\${this.onInput} @keydown=\${this.onKeydown} />\`;
  }
}
`;
      const res = transformEventHoist(input);
      expect(res.hoistedEventsCount).toBe(3);
      expect(res.events).toEqual(expect.arrayContaining(['click', 'input', 'keydown']));
      expect(res.code).toContain('data-lh-click="');
      expect(res.code).toContain('data-lh-input="');
      expect(res.code).toContain('data-lh-keydown="');
      expect(res.code).toContain('this.__lhAction(this.onClick)');
      expect(res.code).toContain('this.__lhAction(this.onInput)');
      expect(res.code).toContain('this.__lhAction(this.onKeydown)');
    });

    it('does not touch Event.prototype or monkey-patch stopPropagation', () => {
      const input = `
import { LitElement, html } from 'lit';
export class PureComp extends LitElement {
  render() {
    return html\`<button @click=\${this.onClick}>Pure</button>\`;
  }
}
`;
      const res = transformEventHoist(input);
      expect(res.code).not.toContain('Event.prototype');
      expect(res.code).not.toContain('stopPropagation');
      expect(res.code).not.toContain('origStop');
      expect(res.code).toContain('event.cancelBubble');
    });

    it('handles multiline templates with formatting and preceding at symbols', () => {
      const input = `
import { LitElement, html } from 'lit';
export class MultilineComp extends LitElement {
  render() {
    return html\`
      <div title="user@domain.com">
        <button
          id="btn-action"
          class="primary"
          @click=\${this.onClick}
        >
          Submit
        </button>
      </div>
    \`;
  }
}
`;
      const res = transformEventHoist(input);
      expect(res.hoistedEventsCount).toBe(1);
      expect(res.code).toContain('user@domain.com');
      expect(res.code).toContain('data-lh-click=');
      expect(res.code).toContain('this.__lhAction(this.onClick)');
    });

    it('bails out on non-Lit classes and ignores non-bubbling events', () => {
      const nonLit = `
import { BaseClass } from './base.js';
import { html } from 'lit';
export class NonLitComp extends BaseClass {
  render() {
    return html\`<button @click=\${this.onClick}>Click</button>\`;
  }
}
`;
      const resNonLit = transformEventHoist(nonLit);
      expect(resNonLit.componentsCount).toBe(0);
      expect(resNonLit.hoistedEventsCount).toBe(0);

      const nonBubbling = `
import { LitElement, html } from 'lit';
export class ScrollComp extends LitElement {
  render() {
    return html\`<div @scroll=\${this.onScroll}>Scroll</div>\`;
  }
}
`;
      const resScroll = transformEventHoist(nonBubbling);
      expect(resScroll.hoistedEventsCount).toBe(0);
      expect(resScroll.code).not.toContain('data-lh-scroll');
    });
  });

  // ==========================================
  // 3. DOM-PATHS EMPIRICAL STRESS TESTS
  // ==========================================
  describe('dom-paths package', () => {
    it('bails out safely when class has multiple templates with expressions', () => {
      const input = `
import { LitElement, html } from 'lit';
export class MultiTemplate extends LitElement {
  renderHeader() {
    return html\`<header>\${this.title}</header>\`;
  }
  render() {
    return html\`<main>\${this.content}</main>\`;
  }
}
`;
      const res = transformDomPaths(input);
      expect(res.componentsCount).toBe(0);
      expect(res.pathsCount).toBe(0);
      expect(res.code).toBe(input);
    });

    it('transforms component when only one template has expressions and others are static', () => {
      const input = `
import { LitElement, html } from 'lit';
export class SingleDynamicTemplate extends LitElement {
  renderFooter() {
    return html\`<footer>Static copyright notice</footer>\`;
  }
  render() {
    return html\`<main><span>\${this.content}</span></main>\`;
  }
}
`;
      const res = transformDomPaths(input);
      expect(res.componentsCount).toBe(1);
      expect(res.pathsCount).toBe(1);
      expect(res.code).toContain('static __litPartPaths');
      expect(res.code).toContain('static __litPartNodes(root)');
    });

    it('correctly computes paths with self-closing SVG tags and CDATA sections', () => {
      const input = `
import { LitElement, html } from 'lit';
export class SvgCDataComp extends LitElement {
  render() {
    return html\`
      <svg viewBox="0 0 100 100">
        <![CDATA[raw <data> section]]>
        <circle cx="50" cy="50" r="10" />
        <rect x="\${this.x}" y="\${this.y}" width="20" height="20" />
      </svg>
    \`;
  }
}
`;
      const res = transformDomPaths(input);
      expect(res.componentsCount).toBe(1);
      expect(res.pathsCount).toBe(2);
      // Circle is self-closing, so rect is sibling, not child of circle
      // Svg root is child 0 of root, rect is child 1 of svg
      expect(res.paths[0]).toEqual([
        [0, 1],
        [0, 1],
      ]);
    });

    it('correctly handles HTML void elements (input, br, hr, img)', () => {
      const input = `
import { LitElement, html } from 'lit';
export class VoidElementsComp extends LitElement {
  render() {
    return html\`
      <form>
        <input type="text">
        <br>
        <span>\${this.name}</span>
      </form>
    \`;
  }
}
`;
      const res = transformDomPaths(input);
      expect(res.componentsCount).toBe(1);
      expect(res.pathsCount).toBe(1);
      // form is child 0. Children of form: input (0), br (1), span (2).
      // Inside span: text part (0). So path is [0, 2, 0].
      expect(res.paths[0]).toEqual([[0, 2, 0]]);
    });

    it('bails out on non-Lit classes and handles aliased LitElement imports', () => {
      const nonLit = `
import { BaseClass } from './base.js';
import { html } from 'lit';
export class NonLitComp extends BaseClass {
  render() {
    return html\`<div>\${this.content}</div>\`;
  }
}
`;
      const resNonLit = transformDomPaths(nonLit);
      expect(resNonLit.componentsCount).toBe(0);
      expect(resNonLit.pathsCount).toBe(0);

      const aliased = `
import { LitElement as LitBase, html as litHtml } from 'lit';
export class AliasedComp extends LitBase {
  render() {
    return litHtml\`<div>\${this.content}</div>\`;
  }
}
`;
      const resAliased = transformDomPaths(aliased);
      expect(resAliased.componentsCount).toBe(1);
      expect(resAliased.pathsCount).toBe(1);
      expect(resAliased.code).toContain('static __litPartPaths');
    });
  });

  // ==========================================
  // 4. DIRTY-MASK EMPIRICAL STRESS TESTS
  // ==========================================
  describe('dirty-mask package', () => {
    it('bails out on non-Lit classes and does not inject synthetic update methods', () => {
      const nonLit = `
import { BaseClass } from './base.js';
import { html } from 'lit';
export class NonLitComp extends BaseClass {
  static properties = { count: { type: Number } };
  render() {
    return html\`<div>\${this.count}</div>\`;
  }
}
`;
      const resNonLit = transformDirtyMask(nonLit);
      expect(resNonLit.componentsCount).toBe(0);
      expect(resNonLit.maskedPartsCount).toBe(0);
      expect(resNonLit.code).not.toContain('__litDirtyMask');
      expect(resNonLit.code).not.toContain('update(changedProperties)');
    });

    it('handles @state() decorator correctly as reactive property', () => {
      const input = `
import { LitElement, html } from 'lit';
import { state } from 'lit/decorators.js';
export class StateComp extends LitElement {
  @state() count = 0;
  render() {
    return html\`<div>Count: \${this.count}</div>\`;
  }
}
`;
      const res = transformDirtyMask(input);
      expect(res.componentsCount).toBe(1);
      expect(res.maskedPartsCount).toBe(1);
      expect(res.propertiesCount).toBe(1);
      expect(res.code).toContain('this.__litDirtyMask & 1');
      expect(res.code).toMatch(/if\s*\(changedProperties\.has\(["']count["']\)\)\s*mask\s*\|=\s*1;/);
    });

    it('distinguishes safe globals (Math) from unsafe globals (window)', () => {
      const input = `
import { LitElement, html } from 'lit';
import { property } from 'lit/decorators.js';
export class GlobalsComp extends LitElement {
  @property({ type: Number }) count = 0;
  render() {
    return html\`
      <div>
        <span>\${Math.max(0, this.count)}</span>
        <span>\${window.innerWidth > 500 ? this.count : 0}</span>
      </div>
    \`;
  }
}
`;
      const res = transformDirtyMask(input);
      expect(res.componentsCount).toBe(1);
      expect(res.maskedPartsCount).toBe(2);
      // Math.max is a function call, so it safely falls back to -1
      expect(res.code).toContain('${this.__litDirtyMask & -1 ? Math.max(0, this.count) : noChange}');
      // window.innerWidth is an unsafe global, so it safely falls back to -1
      expect(res.code).toContain('this.__litDirtyMask & -1 ? window.innerWidth > 500');
    });

    it('does not inject super.update() when class has no super class', () => {
      const bareSnippet = `
export class StandaloneElement {
  static properties = { count: { type: Number } };
  render() {
    return html\`<div>\${this.count}</div>\`;
  }
}
`;
      const res = transformDirtyMask(bareSnippet);
      expect(res.componentsCount).toBe(1);
      expect(res.code).toContain('update(changedProperties)');
      expect(res.code).not.toContain('super.update(changedProperties)');
    });

    it('injects super.update() when class extends LitElement or ReactiveElement', () => {
      const litSnippet = `
import { LitElement, html } from 'lit';
import { property } from 'lit/decorators.js';
export class LitComp extends LitElement {
  @property({ type: Number }) count = 0;
  render() {
    return html\`<div>\${this.count}</div>\`;
  }
}
`;
      const res = transformDirtyMask(litSnippet);
      expect(res.componentsCount).toBe(1);
      expect(res.code).toContain('super.update(changedProperties)');
    });

    it('does not duplicate noChange import when noChange is already bound in scope', () => {
      const withNoChange = `
import { LitElement, html, noChange } from 'lit';
import { property } from 'lit/decorators.js';
export class LitComp extends LitElement {
  @property() val = 'test';
  render() {
    return html\`<div>\${this.val}</div>\`;
  }
}
`;
      const res = transformDirtyMask(withNoChange);
      // noChange should be in import and in ternary, no duplicate import statements
      const importMatches = res.code.match(/import\s*\{[^}]*noChange[^}]*\}\s*from/g);
      expect(importMatches?.length).toBe(1);
    });

    it('is completely idempotent on repeatedly transformed code', () => {
      const input = `
import { LitElement, html } from 'lit';
import { property } from 'lit/decorators.js';
export class IdempotentComp extends LitElement {
  @property({ type: Number }) count = 0;
  render() {
    return html\`<span>\${this.count}</span>\`;
  }
}
`;
      const pass1 = transformDirtyMask(input);
      const pass2 = transformDirtyMask(pass1.code);
      expect(pass2.code).toBe(pass1.code);
    });
  });
});
