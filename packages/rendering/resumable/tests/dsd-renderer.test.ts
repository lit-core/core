import { html, nothing } from 'lit';
import { expect, it } from 'vitest';
import { renderComponentToDsd, renderTemplateResult } from '../src/server/dsd-renderer.js';

it('renders the nothing sentinel as empty output', () => {
  expect(renderTemplateResult(html`<p>${nothing}</p>`)).toBe('<p></p>');
});

it('escapes string children inside arrays', () => {
  const out = renderTemplateResult(html`<ul>${['<img src=x onerror=alert(1)>', html`<li>ok</li>`]}</ul>`);
  expect(out).not.toContain('<img');
  expect(out).toContain('&lt;img');
  expect(out).toContain('<li>ok</li>');
});

it('escapes double quotes so attribute values cannot break out', () => {
  const out = renderTemplateResult(html`<a title="${'x" onmouseover="alert(1)'}">a</a>`);
  expect(out).toBe('<a title="x&quot; onmouseover=&quot;alert(1)">a</a>');
});

it('uses an explicit tagName option over the instance fallback', () => {
  const component = { constructor: class {}, render: () => html`<i></i>` };
  expect(renderComponentToDsd(component, { tagName: 'My-Tag' }).startsWith('<my-tag>')).toBe(true);
});
