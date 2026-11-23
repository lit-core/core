import { html } from 'lit';
import { unsafeHTML as litUnsafeHtml } from 'lit/directives/unsafe-html.js';
import { unsafeSVG as litUnsafeSvg } from 'lit/directives/unsafe-svg.js';
import { describe, expect, it } from 'vitest';
import { renderToString, unsafeHTML } from '../src/index.js';

const MARKUP = '<img src=x onerror=alert(1)>';
const ESCAPED = '&lt;img src=x onerror=alert(1)&gt;';

describe('raw HTML trust boundary', () => {
  describe('values that look like raw markup are always escaped', () => {
    const lookalikes: Array<[string, unknown]> = [
      ['an object with an html field', { html: MARKUP }],
      ['an object with a template field', { template: MARKUP }],
      ['an object with a tagName field', { tagName: 'script', html: MARKUP }],
      ['an object with a render method', { render: () => MARKUP, html: MARKUP }],
      ['parsed JSON shaped like a render result', JSON.parse(`{"html":${JSON.stringify(MARKUP)},"tagName":"x-y"}`)],
      ['an object carrying a registered-symbol brand guess', { [Symbol.for('lit-core.raw-html')]: true, html: MARKUP }],
    ];

    for (const [label, value] of lookalikes) {
      it(`escapes ${label} in child position`, () => {
        const output = renderToString(html`<div>${value}</div>`);
        expect(output).not.toContain('<img');
        expect(output).toContain('<div>');
      });
    }

    it('escapes plain strings in child position', () => {
      expect(renderToString(html`<p>${MARKUP}</p>`)).toContain(ESCAPED);
    });

    it('escapes lookalike objects bound to attributes', () => {
      const output = renderToString(html`<div title=${{ html: '"><script>x</script>' }}></div>`);
      expect(output).not.toContain('<script>');
    });
  });

  describe('only the unforgeable brand emits raw markup', () => {
    it('emits markup from lit unsafeHTML', () => {
      expect(renderToString(html`<div>${litUnsafeHtml('<b>bold</b>')}</div>`)).toContain('<b>bold</b>');
    });

    it('emits markup from lit unsafeSVG', () => {
      expect(renderToString(html`<svg>${litUnsafeSvg('<circle r="1"></circle>')}</svg>`)).toContain('<circle r="1"></circle>');
    });

    it('emits markup from the engine unsafeHTML', () => {
      expect(renderToString(html`<div>${unsafeHTML('<i>raw</i>')}</div>`)).toContain('<i>raw</i>');
    });

    it('keeps escaping sibling bindings next to a trusted one', () => {
      const output = renderToString(html`<div>${litUnsafeHtml('<b>ok</b>')}${MARKUP}</div>`);
      expect(output).toContain('<b>ok</b>');
      expect(output).toContain(ESCAPED);
    });
  });

  it('does not let a trusted result survive being copied into a plain object', () => {
    const trusted = unsafeHTML('<u>raw</u>');
    const copy = { ...trusted };
    expect(renderToString(html`<div>${copy}</div>`)).not.toContain('<u>raw</u>');
  });
});
