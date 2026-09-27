import { describe, expect, it } from 'vitest';
import { transformDirtyMask } from '../src/index.js';
import { transformDirtyMaskJs } from '../src/js-fallback.js';

describe('dirty-mask transform', () => {
  const implementations = [
    { name: 'main (native/fallback)', fn: transformDirtyMask },
    { name: 'pure js fallback', fn: transformDirtyMaskJs },
  ];

  implementations.forEach(({ name, fn }) => {
    describe(`${name} implementation`, () => {
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

        expect(res.code).toContain('(this.__litDirtyMask & 1) ? (this.count) : noChange');
        expect(res.code).toContain('update(changedProperties)');
        expect(res.code).toContain("if (changedProperties.has('count')) mask |= 1;");
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
        expect(res.code).toContain("(this.__litDirtyMask & 3) ? (this.firstName + ' ' + this.lastName) : noChange");
        // active = 4 -> mask = 4
        expect(res.code).toContain("(this.__litDirtyMask & 4) ? (this.active ? 'Active' : 'Inactive') : noChange");
        expect(res.code).toContain("if (changedProperties.has('firstName')) mask |= 1;");
        expect(res.code).toContain("if (changedProperties.has('lastName')) mask |= 2;");
        expect(res.code).toContain("if (changedProperties.has('active')) mask |= 4;");
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

        expect(res.code).toContain('(this.__litDirtyMask & 1) ? (this.status) : noChange');
        expect(res.code).toContain('(this.__litDirtyMask & 2) ? (this.code) : noChange');
        expect(res.code).toContain("if (changedProperties.has('status')) mask |= 1;");
        expect(res.code).toContain("if (changedProperties.has('code')) mask |= 2;");
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

        expect(res.code).toContain('(this.__litDirtyMask & 1) ? (this.title) : noChange');
        expect(res.code).toContain('(this.__litDirtyMask & 2) ? (this.rating) : noChange');
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

        expect(res.code).toContain('(this.__litDirtyMask & 1) ? (this.title) : noChange');
        expect(res.code).toContain('(this.__litDirtyMask & -1) ? (this.internalId) : noChange');
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

        expect(res.code).toContain('(this.__litDirtyMask & 1) ? (this.count) : noChange');
        expect(res.code).toContain('(this.__litDirtyMask & -1) ? (EXTERNAL_CONFIG) : noChange');
        expect(res.code).toContain('(this.__litDirtyMask & -1) ? (this.formatCount(this.count)) : noChange');
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
        expect(res.code).toContain("console.log('pre-update')");
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
        expect(resWithoutLit.code).toContain("import { noChange } from 'lit';");
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
    });
  });
});
