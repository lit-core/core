import { html, nothing } from 'lit';
import { expect, it } from 'vitest';
import { createIsolateEnvironment, renderToString } from '../../ssr/src/index.js';

it('renders the nothing sentinel as empty output', () => {
  expect(renderToString(html`<p>${nothing}</p>`, { resumable: true })).toBe('<p></p>');
});

it('escapes string children inside arrays', () => {
  const out = renderToString(html`<ul>${['<img src=x onerror=alert(1)>', html`<li>ok</li>`]}</ul>`, { resumable: true });
  expect(out).not.toContain('<img');
  expect(out).toContain('&lt;img');
  expect(out).toContain('<li>ok</li>');
});

it('escapes double quotes so attribute values cannot break out', () => {
  const out = renderToString(html`<a title="${'x" onmouseover="alert(1)'}">a</a>`, { resumable: true });
  expect(out).toBe('<a title="x&quot; onmouseover=&quot;alert(1)">a</a>');
});

it('renders registered custom elements into lowercase Declarative Shadow DOM tags', () => {
  const env = createIsolateEnvironment();
  class MyTagElement extends env.HTMLElement {
    render() {
      return html`<i></i>`;
    }
  }
  env.customElements.define('My-Tag', MyTagElement);
  const out = renderToString(html`<My-Tag></My-Tag>`, { customElements: env.customElements, resumable: true });
  expect(out).toBe('<my-tag><template shadowrootmode="open"><i></i></template></my-tag>');
});
