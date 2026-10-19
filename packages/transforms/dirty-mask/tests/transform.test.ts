import { describe, expect, it } from 'vitest';
import { transformDirtyMask } from '../src/index.js';

function expectMasked(code: string, mask: number | string, expr: string) {
  const norm = code.replace(/\s+/g, ' ');
  const p1 = `(this.__litDirtyMask & ${mask}) ? (${expr}) : noChange`;
  const p2 = `this.__litDirtyMask & ${mask} ? ${expr} : noChange`;
  expect(norm.includes(p1) || norm.includes(p2)).toBe(true);
}

describe('dirty-mask transform', () => {
  const fn = transformDirtyMask;
  it('masks single-property bindings with incremental bit indices', () => {
    const input = `
import { LitElement, html } from 'lit';
import { property } from 'lit/decorators.js';

export class CounterComponent extends LitElement {
  @property({ type: Number }) count = 0;

  render() {
    return html\`<span>Count: \${this.count}</span>\`;
  }
}
`;
    const res = fn(input);
    expect(res.componentsCount).toBe(1);
    expect(res.maskedPartsCount).toBe(1);
    expect(res.propertiesCount).toBe(1);

    expectMasked(res.code, 1, 'this.count');
    expect(res.code).toContain('update(changedProperties)');
    expect(res.code).toMatch(/if\s*\(changedProperties\.has\(["']count["']\)\)\s*mask\s*\|=\s*1;/);
    expect(res.code).toContain('this.__litDirtyMask = mask;');
    expect(res.code).toContain('noChange');
  });

  it('combines bitmasks for multi-property expressions', () => {
    const input = `
import { LitElement, html } from 'lit';
import { property } from 'lit/decorators.js';

export class UserBadge extends LitElement {
  @property() firstName = 'Jane';
  @property() lastName = 'Doe';
  @property({ type: Boolean }) active = true;

  render() {
    return html\`
      <div class="user">
        <span>\${this.firstName + ' ' + this.lastName}</span>
        <span>\${this.active ? 'Active' : 'Inactive'}</span>
      </div>
    \`;
  }
}
`;
    const res = fn(input);
    expect(res.componentsCount).toBe(1);
    expect(res.maskedPartsCount).toBe(2);
    expect(res.propertiesCount).toBe(3);

    // firstName = 1, lastName = 2 -> mask = 3
    expect(res.code.includes('this.__litDirtyMask & 3') || res.code.includes('(this.__litDirtyMask & 3)')).toBe(true);
    // active = 4 -> mask = 4
    expect(res.code.includes('this.__litDirtyMask & 4') || res.code.includes('(this.__litDirtyMask & 4)')).toBe(true);
    expect(res.code).toMatch(/if\s*\(changedProperties\.has\(["']firstName["']\)\)\s*mask\s*\|=\s*1;/);
    expect(res.code).toMatch(/if\s*\(changedProperties\.has\(["']lastName["']\)\)\s*mask\s*\|=\s*2;/);
    expect(res.code).toMatch(/if\s*\(changedProperties\.has\(["']active["']\)\)\s*mask\s*\|=\s*4;/);
  });

  it('detects static properties = { ... } definitions', () => {
    const input = `
import { LitElement, html } from 'lit';

export class StatusIndicator extends LitElement {
  static properties = {
    status: { type: String },
    code: { type: Number },
  };

  render() {
    return html\`<span>Status: \${this.status}, Code: \${this.code}</span>\`;
  }
}
`;
    const res = fn(input);
    expect(res.componentsCount).toBe(1);
    expect(res.maskedPartsCount).toBe(2);
    expect(res.propertiesCount).toBe(2);

    expectMasked(res.code, 1, 'this.status');
    expectMasked(res.code, 2, 'this.code');
    expect(res.code).toMatch(/if\s*\(changedProperties\.has\(["']status["']\)\)\s*mask\s*\|=\s*1;/);
    expect(res.code).toMatch(/if\s*\(changedProperties\.has\(["']code["']\)\)\s*mask\s*\|=\s*2;/);
  });

  it('detects static get properties() { return { ... } }', () => {
    const input = `
import { LitElement, html } from 'lit';

export class CardElement extends LitElement {
  static get properties() {
    return {
      title: { type: String },
      rating: { type: Number },
    };
  }

  render() {
    return html\`<div>\${this.title} - \${this.rating}</div>\`;
  }
}
`;
    const res = fn(input);
    expect(res.componentsCount).toBe(1);
    expect(res.maskedPartsCount).toBe(2);
    expect(res.propertiesCount).toBe(2);

    expectMasked(res.code, 1, 'this.title');
    expectMasked(res.code, 2, 'this.rating');
  });

  it('assigns mask -1 fallback to non-reactive fields on this', () => {
    const input = `
import { LitElement, html } from 'lit';
import { property } from 'lit/decorators.js';

export class HeaderView extends LitElement {
  @property() title = 'Dashboard';
  internalId = 'id-123';

  render() {
    return html\`<h1>\${this.title} - \${this.internalId}</h1>\`;
  }
}
`;
    const res = fn(input);
    expect(res.componentsCount).toBe(1);
    expect(res.maskedPartsCount).toBe(2);

    expectMasked(res.code, 1, 'this.title');
    expectMasked(res.code, -1, 'this.internalId');
  });

  it('assigns mask -1 fallback to external variables and functions with potential side effects', () => {
    const input = `
import { LitElement, html } from 'lit';
import { property } from 'lit/decorators.js';

const EXTERNAL_CONFIG = 'Prod';

export class ComplexComponent extends LitElement {
  @property({ type: Number }) count = 0;

  formatCount(c) {
    return '#' + c;
  }

  render() {
    return html\`
      <div>
        <span>\${this.count}</span>
        <span>\${EXTERNAL_CONFIG}</span>
        <span>\${this.formatCount(this.count)}</span>
      </div>
    \`;
  }
}
`;
    const res = fn(input);
    expect(res.componentsCount).toBe(1);
    expect(res.maskedPartsCount).toBe(3);

    expectMasked(res.code, 1, 'this.count');
    expectMasked(res.code, -1, 'EXTERNAL_CONFIG');
    expectMasked(res.code, -1, 'this.formatCount(this.count)');
  });

  it('injects mask computation into existing update lifecycle method', () => {
    const input = `
import { LitElement, html } from 'lit';
import { property } from 'lit/decorators.js';

export class CustomLifecycle extends LitElement {
  @property() value = '';

  update(changedProperties) {
    console.log('pre-update');
    super.update(changedProperties);
  }

  render() {
    return html\`<p>\${this.value}</p>\`;
  }
}
`;
    const res = fn(input);
    expect(res.componentsCount).toBe(1);
    expect(res.maskedPartsCount).toBe(1);

    expect(res.code).toContain('this.__litDirtyMask = mask;');
    expect(res.code).toMatch(/console\.log\(["']pre-update["']\)/);
    expect(res.code).toContain('super.update(changedProperties)');
    // Ensure update method is defined only once
    const updateMatches = res.code.match(/\bupdate\s*\([^)]*\)\s*\{/g);
    expect(updateMatches?.length).toBe(1);
  });

  it('adds noChange to existing lit import or creates a new import', () => {
    const inputWithLit = `
import { LitElement, html } from 'lit';
import { property } from 'lit/decorators.js';

export class SimpleEl extends LitElement {
  @property() text = '';
  render() { return html\`<div>\${this.text}</div>\`; }
}
`;
    const resWithLit = fn(inputWithLit);
    expect(resWithLit.code).toContain('noChange');
    expect(resWithLit.code).toMatch(/import\s*\{[^}]*noChange[^}]*\}\s*from\s*['"]lit['"]/);

    const inputWithoutLit = `
export class BareEl {
  static properties = { label: { type: String } };
  render() { return html\`<div>\${this.label}</div>\`; }
}
`;
    const resWithoutLit = fn(inputWithoutLit);
    expect(resWithoutLit.code).toMatch(/import\s*\{\s*noChange\s*\}\s*from\s*['"]lit['"]/);
  });

  it('detects compiled __decorate and createProperty property definitions', () => {
    const input = `
import { LitElement, html } from 'lit';
import { property } from 'lit/decorators.js';

export class CompiledEl extends LitElement {
  render() { return html\`<div>\${this.title}</div>\`; }
}
CompiledEl.createProperty("title", { type: String });
`;
    const res = fn(input);
    expect(res.componentsCount).toBe(1);
    expect(res.maskedPartsCount).toBe(1);
    expect(res.code).toContain('this.__litDirtyMask & 1');
  });

  it('is idempotent and does not re-wrap already masked expressions', () => {
    const input = `
import { LitElement, html, noChange } from 'lit';
import { property } from 'lit/decorators.js';

export class SimpleEl extends LitElement {
  @property() text = '';
  render() { return html\`<div>\${this.text}</div>\`; }
}
`;
    const firstPass = fn(input);
    const secondPass = fn(firstPass.code);
    expect(secondPass.code).toBe(firstPass.code);
  });

  it('handles aliased noChange imports without emitting unaliased noChange', () => {
    const input = `
import { LitElement, html, noChange as nc } from 'lit';
import { property } from 'lit/decorators.js';

export class LitComp extends LitElement {
  @property() name = 'world';
  render() { return html\`<div>\${this.name}</div>\`; }
}
`;
    const res = fn(input);
    expect(res.componentsCount).toBe(1);
    expect(res.maskedPartsCount).toBe(1);
    expect(res.code).toContain('? this.name : nc');
    expect(res.code).not.toContain('? this.name : noChange');
    expect(res.code).not.toMatch(/import\s*\{[^}]*\bnoChange\b(?!\s+as)[^}]*\}\s*from/);
  });

  it('synthesizes conflict-free alias when unrelated noChange exists in root scope', () => {
    const input = `
import { LitElement, html } from 'lit';
import { property } from 'lit/decorators.js';

const noChange = 'unrelated local constant';

export class LitComp extends LitElement {
  @property() name = 'world';
  render() { return html\`<div>\${this.name}</div>\`; }
}
`;
    const res = fn(input);
    expect(res.componentsCount).toBe(1);
    expect(res.maskedPartsCount).toBe(1);
    expect(res.code).toContain('? this.name : _litNoChange');
    expect(res.code).not.toContain('? this.name : noChange');
    expect(res.code).toMatch(/noChange as _litNoChange/);
    expect(res.code).toMatch(/const noChange = ["']unrelated local constant["'];/);
  });

  it('recognizes intra-module intermediate base classes extending LitElement', () => {
    const input = `
import { LitElement, html } from 'lit';
import { property } from 'lit/decorators.js';

export class BaseElement extends LitElement {}

export class MyElement extends BaseElement {
  @property() name = 'world';
  render() { return html\`<div>\${this.name}</div>\`; }
}
`;
    const res = fn(input);
    expect(res.componentsCount).toBe(1);
    expect(res.maskedPartsCount).toBe(1);
    expect(res.code).toContain('? this.name : noChange');
    expect(res.code).toContain('super.update(changedProperties)');
  });

  it('inherits reactive properties from in-module base classes', () => {
    const input = `
import { LitElement, html } from 'lit';
import { property } from 'lit/decorators.js';

export class BaseElement extends LitElement {
  @property() baseProp = 'base';
}

export class MyElement extends BaseElement {
  @property() childProp = 'child';
  render() {
    return html\`<div>\${this.baseProp + ' ' + this.childProp}</div>\`;
  }
}
`;
    const res = fn(input);
    expect(res.componentsCount).toBe(1);
    expect(res.maskedPartsCount).toBe(1);
    expect(res.propertiesCount).toBe(2);
    expect(res.code).toContain('this.__litDirtyMask & 3');
    expect(res.code).toMatch(/if\s*\(changedProperties\.has\(["']baseProp["']\)\)\s*mask\s*\|=\s*1;/);
    expect(res.code).toMatch(/if\s*\(changedProperties\.has\(["']childProp["']\)\)\s*mask\s*\|=\s*2;/);
  });

  it('handles multi-level intermediate inheritance hierarchies', () => {
    const input = `
import { LitElement, html } from 'lit';
import { property } from 'lit/decorators.js';

export class RootElement extends LitElement {
  @property() rootVal = 1;
}

export class MidElement extends RootElement {
  @property() midVal = 2;
}

export class LeafElement extends MidElement {
  @property() leafVal = 3;
  render() {
    return html\`<div>\${this.rootVal + ' ' + this.leafVal}</div>\`;
  }
}
`;
    const res = fn(input);
    expect(res.componentsCount).toBe(1);
    expect(res.maskedPartsCount).toBe(1);
    expect(res.propertiesCount).toBe(3);
    // rootVal = 1 (1 << 0 = 1), midVal = 2 (1 << 1 = 2), leafVal = 3 (1 << 2 = 4)
    // rootVal + leafVal = 1 | 4 = 5
    expect(res.code).toContain('this.__litDirtyMask & 5');
    expect(res.code).toMatch(/if\s*\(changedProperties\.has\(["']rootVal["']\)\)\s*mask\s*\|=\s*1;/);
    expect(res.code).toMatch(/if\s*\(changedProperties\.has\(["']midVal["']\)\)\s*mask\s*\|=\s*2;/);
    expect(res.code).toMatch(/if\s*\(changedProperties\.has\(["']leafVal["']\)\)\s*mask\s*\|=\s*4;/);
  });

  it('guards dirty mask assignment against superclass update clobbering', () => {
    const input = `
import { LitElement, html } from 'lit';

export class BaseElement extends LitElement {
  static properties = { baseProp: { type: String } };
  render() {
    return html\`<div>\${this.baseProp}</div>\`;
  }
}

export class LeafElement extends BaseElement {
  static properties = { childProp: { type: String } };
  render() {
    return html\`<div>\${this.childProp}</div>\`;
  }
}
`;
    const res = fn(input);
    expect(res.componentsCount).toBe(2);
    expect(res.code).toContain('this.__litDirtyMask = mask;');

    // Lifecycle simulation
    class FakeLitElement {
      hasUpdated = true;
      update(_changedProps: Map<string, unknown>) {}
    }

    const noChange = Symbol.for('lit-noChange');
    const html = (_strings: TemplateStringsArray, ...values: unknown[]) => values[0];

    const cleanCode = res.code
      .replace(/import\s*\{[^}]*\}\s*from\s*["\x27][^"\x27]+["\x27];?/g, '')
      .replace(/export class BaseElement extends LitElement/g, 'class BaseElement extends FakeLitElement')
      .replace(/export class LeafElement extends BaseElement/g, 'class LeafElement extends BaseElement');

    const fnEval = new Function(
      'FakeLitElement',
      'noChange',
      'html',
      `
      ${cleanCode}
      return { BaseElement, LeafElement };
    `,
    );
    const { LeafElement } = fnEval(FakeLitElement, noChange, html) as {
      LeafElement: new () => {
        childProp: string;
        __litDirtyMask: number;
        update: (changedProps: Map<string, unknown>) => void;
        render: () => unknown;
      };
    };

    const leaf = new LeafElement();
    leaf.childProp = 'updated child value';
    leaf.update(new Map([['childProp', 'child']]));

    expect(leaf.__litDirtyMask).toBe(2);
    expect(leaf.render()).toBe('updated child value');
  });

  it('supports anonymous class expressions assigned to variable declarations inheriting base properties', () => {
    const input = `
import { LitElement, html } from 'lit';
const Base = class extends LitElement {
  static properties = { b: { type: String } };
};
const Child = class extends Base {
  static properties = { c: { type: String } };
  render() { return html\`<div>\${this.b} - \${this.c}</div>\`; }
};
`;
    const res = fn(input);
    expect(res.componentsCount).toBe(1);
    expect(res.maskedPartsCount).toBe(2);
    expect(res.propertiesCount).toBe(2);

    expect(res.code).toContain('this.__litDirtyMask & 1 ? this.b : noChange');
    expect(res.code).toContain('this.__litDirtyMask & 2 ? this.c : noChange');
    expect(res.code).not.toContain('this.__litDirtyMask & -1');
    expect(res.code).toContain('this.__litDirtyMask = mask;');
  });

  it('supports exported variable declarations with class expressions in inheritance hierarchies', () => {
    const input = `
import { LitElement, html } from 'lit';
export const Base = class extends LitElement {
  static properties = { x: { type: Number } };
};
export const Derived = class extends Base {
  static properties = { y: { type: Number } };
  render() { return html\`<div>\${this.x + this.y}</div>\`; }
};
`;
    const res = fn(input);
    expect(res.componentsCount).toBe(1);
    expect(res.propertiesCount).toBe(2);
    // x = 1 (bit 1), y = 2 (bit 2) -> mask = 3
    expect(res.code).toContain('this.__litDirtyMask & 3');
    expect(res.code).toContain('this.__litDirtyMask = mask;');
  });

  it('does not wrap event bindings or directives in dirty bitmask checks', () => {
    const input = `
import { LitElement, html } from 'lit';
import { classMap } from 'lit/directives/class-map.js';

export class MyButton extends LitElement {
  static properties = {
    active: { type: Boolean },
    label: { type: String },
  };

  handleClick(e) {
    console.log(e);
  }

  render() {
    return html\`
      <button
        class=\${classMap({ active: this.active })}
        @click=\${this.handleClick}
      >
        \${this.label}
      </button>
    \`;
  }
}
`;
    const res = fn(input);
    expect(res.componentsCount).toBe(1);
    // Only this.label should be masked; classMap and @click should NOT be masked
    expect(res.maskedPartsCount).toBe(1);
    expect(res.code).toContain('this.__litDirtyMask & 2 ? this.label : noChange');
    expect(res.code).not.toContain('classMap({ active: this.active }) : noChange');
    expect(res.code).not.toContain('this.handleClick : noChange');
  });

  it('does not wrap data-lh-* hoisted event bindings or __lhAction calls in noChange', () => {
    const input = `
import { LitElement, html } from 'lit';

export class HoistedButton extends LitElement {
  static properties = {
    count: { type: Number },
  };

  onClick() {}

  render() {
    return html\`<button data-lh-click="\${this.__lhAction(this.onClick)}">Count: \${this.count}</button>\`;
  }
}
`;
    const res = fn(input);
    expect(res.componentsCount).toBe(1);
    expect(res.maskedPartsCount).toBe(1);
    expect(res.code).toContain('this.__litDirtyMask & 1 ? this.count : noChange');
    expect(res.code).not.toContain('this.__lhAction(this.onClick) : noChange');
    expect(res.code).toContain('data-lh-click="${this.__lhAction(this.onClick)}"');
  });

  it('bails out cleanly when component defines 32 or more reactive properties', () => {
    const props = Array.from({ length: 33 }, (_, i) => `p${i}: { type: String }`).join(',\n    ');
    const input = `
import { LitElement, html } from 'lit';

export class GiantComponent extends LitElement {
  static properties = {
    ${props}
  };

  render() {
    return html\`<div>\${this.p0}</div>\`;
  }
}
`;
    const res = fn(input);
    expect(res.componentsCount).toBe(0);
    expect(res.maskedPartsCount).toBe(0);
    expect(res.code).not.toContain('__litDirtyMask');
  });
});
