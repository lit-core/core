import { html } from 'lit';
import { describe, expect, it } from 'vitest';
import { renderToString } from '../src/index.js';

const PAYLOAD = '</textarea></title></style></script><img src=x onerror=alert(1)>';

describe('values in raw-text and attribute contexts', () => {
  it('cannot close a textarea or title with a bound value (bindings there are refused or escaped)', () => {
    for (const template of [html`<textarea>${PAYLOAD}</textarea>`, html`<title>${PAYLOAD}</title>`]) {
      let out = '';
      try {
        out = renderToString(template);
      } catch {
        continue; // failing closed is safe
      }
      expect(out).not.toMatch(/<img/i);
    }
  });

  it('cannot break out of a quoted attribute', () => {
    const out = renderToString(html`<a title="${'"><img src=x onerror=alert(1)>'}">x</a>`);
    expect(out).not.toMatch(/<img/i);
  });

  it('cannot break out of an unquoted attribute', () => {
    const out = renderToString(html`<a title=${'x onmouseover=alert(1)'}>x</a>`);
    // The value stays inside the quoted title, so it never becomes an attribute of its own.
    expect(out).toContain('title="x onmouseover=alert(1)"');
  });

  it('cannot inject an attribute through a bound value in a comment', () => {
    const out = renderToString(html`<p>${'--><img src=x onerror=alert(1)><!--'}</p>`);
    expect(out).not.toMatch(/<img/i);
  });

  it('escapes a value bound inside a style or script element instead of emitting it raw', () => {
    for (const template of [html`<style>${PAYLOAD}</style>`, html`<script>${PAYLOAD}</script>`]) {
      let out: string;
      try {
        out = renderToString(template);
      } catch {
        continue; // refusing to render a binding in a raw-text element is also safe
      }
      expect(out).not.toMatch(/<img/i);
    }
  });
});
