import { describe, expect, it } from 'vitest';
import { classify, transformNative } from '../src/index.js';

describe('Mode B directive lowering compiler', () => {
  it('classifies component with repeat() directive as Mode B micro', () => {
    const input = `
import { LitElement, html } from 'lit';
import { repeat } from 'lit/directives/repeat.js';

export class TodoList extends LitElement {
  render() {
    return html\`
      <ul>
        \${repeat(this.items, (i) => i.id, (i) => html\`<li>\${i.text}</li>\`)}
      </ul>
    \`;
  }
}
customElements.define('todo-list', TodoList);
`;
    const res = classify(input);
    expect(res).toHaveLength(1);
    expect(res[0].mode).toBe('micro');
    expect(res[0].componentName).toBe('TodoList');
    expect(res[0].tagName).toBe('todo-list');
    expect(res[0].reason).toContain('structural');
  });

  it('lowers classMap directive and eliminates directive import', () => {
    const input = `
import { LitElement, html } from 'lit';
import { classMap } from 'lit/directives/class-map.js';

export class BannerAlert extends LitElement {
  render() {
    return html\`
      <div class="\${classMap({ active: this.active, urgent: this.urgent })}">
        <slot></slot>
      </div>
    \`;
  }
}
`;
    const res = transformNative(input);
    expect(res.microCount).toBe(1);
    expect(res.vanillaCount).toBe(0);

    // Verify directive import was eliminated
    expect(res.code).not.toContain('lit/directives/class-map.js');
    expect(res.code).not.toContain('classMap(');

    // Verify lowered inline expressions
    expect(res.code).toContain('.filter(Boolean).join(" ")');
  });

  it('lowers ifDefined directive to nullish coalescing', () => {
    const input = `
import { LitElement, html } from 'lit';
import { ifDefined } from 'lit/directives/if-defined.js';

export class LinkButton extends LitElement {
  render() {
    return html\`
      <a href="\${ifDefined(this.href)}">Click</a>
    \`;
  }
}
`;
    const res = transformNative(input);
    expect(res.microCount).toBe(1);

    // Verify directive import was eliminated
    expect(res.code).not.toContain('lit/directives/if-defined.js');
    expect(res.code).not.toContain('ifDefined(');
    expect(res.code).toContain('?? nothing');
  });

  it('respects forced mode overrides', () => {
    const input = `
import { LitElement, html } from 'lit';

export class Card extends LitElement {
  render() {
    return html\`<div>Card content</div>\`;
  }
}
`;
    const microForced = classify(input, { mode: 'micro-only' });
    expect(microForced[0].mode).toBe('micro');

    const vanillaForced = classify(input, { mode: 'vanilla-only' });
    expect(vanillaForced[0].mode).toBe('vanilla');
  });
});
