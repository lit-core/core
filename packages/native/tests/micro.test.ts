import { describe, expect, it } from 'vitest';
import { classify, transformNative } from '../src/index.js';

describe('Mode B micro-runtime compiler', () => {
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
    expect(res[0].reason).toContain('repeat()');
  });

  it('compiles complex component to NativeElement micro-runtime', () => {
    const input = `
import { LitElement, html } from 'lit';
import { repeat } from 'lit/directives/repeat.js';

export class DataGrid extends LitElement {
  render() {
    return html\`
      <div>
        \${repeat(this.rows, (r) => r.id, (r) => html\`<div class="row">\${r.val}</div>\`)}
      </div>
    \`;
  }
}
customElements.define('data-grid', DataGrid);
`;
    const res = transformNative(input);
    expect(res.microCount).toBe(1);
    expect(res.vanillaCount).toBe(0);
    expect(res.code).toContain('class DataGrid extends NativeElement');
    expect(res.code).toContain('@lit-core/native/runtime');
    expect(res.code).toContain('reconciler');
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
