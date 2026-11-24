import { html } from 'lit';
import { describe, expect, it } from 'vitest';
import { ServerElement } from '../../src/element.js';
import { renderServerElement } from '../../src/render/index.js';

const secret = 'form-size-test-secret-at-least-32-chars!';

/** A list with one form per row, the pattern that used to repeat the whole signed state in every form. */
class RowList extends ServerElement {
  static properties = { items: { state: true } };
  items: Array<{ id: string; title: string }> = [];
  static __lit_actions = { '00000000000000e1': { name: 'toggle', writes: ['items'], validate: (a: unknown[]) => a } };
  render() {
    return html`<ul>${this.items.map((item) => html`<li><form method="post" action=${this.actionUrl('toggle')}>${this.formFields()}<input type="hidden" name="id" value=${item.id}><button>${item.title}</button></form></li>`)}</ul>`;
  }
}

async function pageBytes(rows: number): Promise<number> {
  class Sized extends RowList {
    items = Array.from({ length: rows }, (_, index) => ({ id: `id${index}`, title: `Task number ${index} with a plausible title` }));
  }
  const rendered = await renderServerElement('row-list', {}, { secret, customElements: { get: () => Sized } as never });
  return rendered.html.length;
}

describe('page size with a form on every row', () => {
  it('grows in proportion to the rows, not with their square', async () => {
    const small = await pageBytes(50);
    const large = await pageBytes(400);
    // Eight times the rows must cost about eight times the bytes. With the state repeated in every form it cost sixty.
    expect(large / small).toBeLessThan(10);
  });

  it('keeps a 400-row page far below a megabyte', async () => {
    expect(await pageBytes(400)).toBeLessThan(400_000);
  });
});
