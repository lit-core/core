import { describe, expect, it } from 'vitest';
import { classify, transformNative } from '../src/index.js';

describe('mode B directive handling', () => {
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

  it('preserves classMap directive and leaves component untouched for directives package', () => {
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
    expect(res.microCount).toBe(0);
    expect(res.vanillaCount).toBe(0);

    // Verify directive import and call are preserved for @lit-core/directives
    expect(res.code).toContain('lit/directives/class-map.js');
    expect(res.code).toContain('classMap(');
  });

  it('preserves ifDefined directive and leaves component untouched for directives package', () => {
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
    expect(res.microCount).toBe(0);

    // Verify directive import and call are preserved for @lit-core/directives
    expect(res.code).toContain('lit/directives/if-defined.js');
    expect(res.code).toContain('ifDefined(');
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
