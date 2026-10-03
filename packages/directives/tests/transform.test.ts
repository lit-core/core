import { describe, expect, it } from 'vitest';
import { transformDirectives } from '../src/index.js';

describe('directives AOT lowering compiler pass', () => {
  it('leaves files without lit directive imports untouched', () => {
    const input = `
      import { LitElement, html } from 'lit';
      export class MyElement extends LitElement {
        render() {
          return html\`<div>hello</div>\`;
        }
      }
    `;
    const res = transformDirectives(input);
    expect(res.loweredCount).toBe(0);
    expect(res.code.trim()).toBe(input.trim());
  });

  it('lowers classMap with static and conditional classes and prunes import', () => {
    const input = `
      import { html } from 'lit';
      import { classMap } from 'lit/directives/class-map.js';

      export function render(item) {
        return html\`<button class=\${classMap({ 'btn': true, 'btn--active': item.active, 'btn--disabled': item.disabled })}>Click</button>\`;
      }
    `;
    const res = transformDirectives(input);
    expect(res.loweredCount).toBe(1);
    expect(res.directivesUsed).toContain('classMap');
    expect(res.code).not.toContain('classMap');
    expect(res.code).not.toContain('lit/directives/class-map.js');
    expect(res.code).toContain('"btn" + (item.active ? " btn--active" : "") + (item.disabled ? " btn--disabled" : "")');
  });

  it('lowers aliased classMap import (minification-safe)', () => {
    const input = `
      import { html } from 'lit';
      import { classMap as c } from 'lit/directives/class-map.js';

      export function render(item) {
        return html\`<button class=\${c({ 'btn': true, 'active': item.active })}>Click</button>\`;
      }
    `;
    const res = transformDirectives(input);
    expect(res.loweredCount).toBe(1);
    expect(res.directivesUsed).toContain('classMap');
    expect(res.code).not.toContain('lit/directives/class-map.js');
    expect(res.code).toContain('"btn" + (item.active ? " active" : "")');
  });

  it('lowers namespace classMap import', () => {
    const input = `
      import { html } from 'lit';
      import * as cm from 'lit/directives/class-map.js';

      export function render(item) {
        return html\`<button class=\${cm.classMap({ 'btn': true, 'active': item.active })}>Click</button>\`;
      }
    `;
    const res = transformDirectives(input);
    expect(res.loweredCount).toBe(1);
    expect(res.code).not.toContain('lit/directives/class-map.js');
    expect(res.code).toContain('"btn" + (item.active ? " active" : "")');
  });

  it('lowers styleMap with camelCase property conversion and prunes import', () => {
    const input = `
      import { html } from 'lit';
      import { styleMap } from 'lit/directives/style-map.js';

      export function render(item) {
        return html\`<div style=\${styleMap({ color: 'red', fontSize: item.size })}></div>\`;
      }
    `;
    const res = transformDirectives(input);
    expect(res.loweredCount).toBe(1);
    expect(res.directivesUsed).toContain('styleMap');
    expect(res.code).not.toContain('styleMap');
    expect(res.code).not.toContain('lit/directives/style-map.js');
    expect(res.code).toContain('"color: red;"');
    expect(res.code).toContain('"font-size: "');
  });

  it('lowers ifDefined and injects nothing into lit import', () => {
    const input = `
      import { html } from 'lit';
      import { ifDefined } from 'lit/directives/if-defined.js';

      export function render(item) {
        return html\`<input aria-label=\${ifDefined(item.label)}>\`;
      }
    `;
    const res = transformDirectives(input);
    expect(res.loweredCount).toBe(1);
    expect(res.directivesUsed).toContain('ifDefined');
    expect(res.code).not.toContain('ifDefined');
    expect(res.code).not.toContain('lit/directives/if-defined.js');
    expect(res.code).toContain('item.label ?? nothing');
    expect(res.code).toMatch(/import\s*\{[^}]*nothing[^}]*\}\s*from\s*["']lit["']/);
  });

  it('lowers when with zero-argument arrow functions', () => {
    const input = `
      import { html } from 'lit';
      import { when } from 'lit/directives/when.js';

      export function render(item) {
        return html\`<div>\${when(item.visible, () => html\`<span>Visible</span>\`, () => html\`<span>Hidden</span>\`)}</div>\`;
      }
    `;
    const res = transformDirectives(input);
    expect(res.loweredCount).toBe(1);
    expect(res.directivesUsed).toContain('when');
    expect(res.code).not.toContain('when(');
    expect(res.code).toContain('item.visible ? html`<span>Visible</span>` : html`<span>Hidden</span>`');
  });

  it('lowers choose with case array and default branch', () => {
    const input = `
      import { html } from 'lit';
      import { choose } from 'lit/directives/choose.js';

      export function render(status) {
        return html\`<div>\${choose(status, [
          ['loading', () => html\`<span>Loading...</span>\`],
          ['error', () => html\`<span>Error</span>\`]
        ], () => html\`<span>Default</span>\`)}</div>\`;
      }
    `;
    const res = transformDirectives(input);
    expect(res.loweredCount).toBe(1);
    expect(res.directivesUsed).toContain('choose');
    expect(res.code).not.toContain('choose(');
    expect(res.code).toContain('status === "loading" ? html`<span>Loading...</span>`');
    expect(res.code).toContain('status === "error" ? html`<span>Error</span>`');
  });

  it('lowers map and join iterables ahead of time', () => {
    const input = `
      import { html } from 'lit';
      import { map } from 'lit/directives/map.js';
      import { join } from 'lit/directives/join.js';

      export function render(items) {
        return html\`
          <ul>\${map(items, (i) => html\`<li>\${i}</li>\`)}</ul>
          <div>\${join(items, ', ')}</div>
        \`;
      }
    `;
    const res = transformDirectives(input);
    expect(res.loweredCount).toBe(2);
    expect(res.directivesUsed).toContain('map');
    expect(res.directivesUsed).toContain('join');
    expect(res.code).not.toContain('lit/directives/map.js');
    expect(res.code).not.toContain('lit/directives/join.js');
    expect(res.code).toContain('Array.from(items,');
    expect(res.code).toContain('.join(');
  });

  it('lowers range with constant length to static array', () => {
    const input = `
      import { html } from 'lit';
      import { range } from 'lit/directives/range.js';

      export function render() {
        return html\`\${range(5)}\`;
      }
    `;
    const res = transformDirectives(input);
    expect(res.loweredCount).toBe(1);
    expect(res.directivesUsed).toContain('range');
    expect(res.code).toMatch(/\[\s*0,\s*1,\s*2,\s*3,\s*4\s*\]/);
  });

  it('lowers guard by inlining zero-arg arrow evaluation', () => {
    const input = `
      import { html } from 'lit';
      import { guard } from 'lit/directives/guard.js';

      export function render(item) {
        return html\`\${guard([item.id], () => html\`<span>\${item.id}</span>\`)}\`;
      }
    `;
    const res = transformDirectives(input);
    expect(res.loweredCount).toBe(1);
    expect(res.directivesUsed).toContain('guard');
    expect(res.code).not.toContain('guard(');
    expect(res.code).toContain('html`<span>${item.id}</span>`');
  });

  it('lowers live, keyed, and cache into lightweight descriptors', () => {
    const input = `
      import { html } from 'lit';
      import { live } from 'lit/directives/live.js';
      import { keyed } from 'lit/directives/keyed.js';
      import { cache } from 'lit/directives/cache.js';

      export function render(item) {
        return html\`
          <input .value=\${live(item.val)}>
          \${keyed(item.id, html\`<div>\${item.text}</div>\`)}
          \${cache(item.view)}
        \`;
      }
    `;
    const res = transformDirectives(input);
    expect(res.loweredCount).toBe(3);
    expect(res.directivesUsed).toContain('live');
    expect(res.directivesUsed).toContain('keyed');
    expect(res.directivesUsed).toContain('cache');
    expect(res.code).toContain('_$litLive$');
    expect(res.code).toContain('_$litKey$');
    expect(res.code).toContain('_$litCache$');
  });

  it('lowers repeat into Array.from map', () => {
    const input = `
      import { html } from 'lit';
      import { repeat } from 'lit/directives/repeat.js';

      export function render(items) {
        return html\`<ul>\${repeat(items, (item) => html\`<li>\${item.name}</li>\`)}</ul>\`;
      }
    `;
    const res = transformDirectives(input);
    expect(res.loweredCount).toBe(1);
    expect(res.directivesUsed).toContain('repeat');
    expect(res.code).not.toContain('repeat(');
    expect(res.code).toContain('Array.from(items,');
  });

  it('lowers templateContent to cloneNode(true)', () => {
    const input = `
      import { html } from 'lit';
      import { templateContent } from 'lit/directives/template-content.js';

      export function render(tpl) {
        return html\`<div>\${templateContent(tpl)}</div>\`;
      }
    `;
    const res = transformDirectives(input);
    expect(res.loweredCount).toBe(1);
    expect(res.directivesUsed).toContain('templateContent');
    expect(res.code).not.toContain('templateContent(');
    expect(res.code).toContain('cloneNode?.(true)');
  });

  it('lowers unsafeHTML, unsafeSVG, and unsafeMathML into static template results', () => {
    const input = `
      import { html } from 'lit';
      import { unsafeHTML } from 'lit/directives/unsafe-html.js';
      import { unsafeSVG } from 'lit/directives/unsafe-svg.js';
      import { unsafeMathML } from 'lit/directives/unsafe-mathml.js';

      export function render(h, s, m) {
        return html\`
          \${unsafeHTML(h)}
          \${unsafeSVG(s)}
          \${unsafeMathML(m)}
        \`;
      }
    `;
    const res = transformDirectives(input);
    expect(res.loweredCount).toBe(3);
    expect(res.directivesUsed).toContain('unsafeHTML');
    expect(res.directivesUsed).toContain('unsafeSVG');
    expect(res.directivesUsed).toContain('unsafeMathML');
    expect(res.code).toContain('_$litType$: 1');
    expect(res.code).toContain('_$litType$: 2');
    expect(res.code).toContain('_$litType$: 3');
  });

  it('lowers until, asyncAppend, asyncReplace, and ref', () => {
    const input = `
      import { html } from 'lit';
      import { until } from 'lit/directives/until.js';
      import { asyncAppend } from 'lit/directives/async-append.js';
      import { asyncReplace } from 'lit/directives/async-replace.js';
      import { ref } from 'lit/directives/ref.js';

      export function render(p, a1, a2, cb) {
        return html\`
          \${until(p)}
          \${asyncAppend(a1)}
          \${asyncReplace(a2)}
          <div \${ref(cb)}></div>
        \`;
      }
    `;
    const res = transformDirectives(input);
    expect(res.loweredCount).toBe(4);
    expect(res.directivesUsed).toContain('until');
    expect(res.directivesUsed).toContain('asyncAppend');
    expect(res.directivesUsed).toContain('asyncReplace');
    expect(res.directivesUsed).toContain('ref');
    expect(res.code).toContain('_$litAsyncAppend$');
    expect(res.code).toContain('_$litAsyncReplace$');
    expect(res.code).toContain('_$litRef$');
  });
});
