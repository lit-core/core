import { describe, expect, it } from 'vitest';
import { NonJsonStateError } from '../../src/canonical-json.js';
import { renderServerElement } from '../../src/edge.js';
import { ServerElement } from '../../src/element.js';

const secret = 'non-json-state-test-secret-32-chars!!';

function elementHolding(value: () => unknown) {
  class Holder extends ServerElement {
    static properties = { held: { state: true } };
    held: unknown = value();
    render() {
      return { strings: ['<p>', '</p>'], values: ['ok'] };
    }
  }
  return { get: (tag: string) => (tag === 'holder-el' ? Holder : undefined) };
}

describe('state that JSON cannot carry', () => {
  it.each([
    ['a Set', () => new Set([1]), 'Set'],
    ['a Map', () => new Map([['a', 1]]), 'Map'],
    ['a Date', () => new Date(0), 'Date'],
  ])('refuses to render an element whose state holds %s, naming the property', async (_label, make, kind) => {
    const failure = await renderServerElement('holder-el', {}, { secret, customElements: elementHolding(make) }).then(
      () => null,
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(NonJsonStateError);
    expect((failure as NonJsonStateError).found).toBe(kind);
    expect((failure as NonJsonStateError).path).toBe('held');
  });

  it('renders the same element once the value is plain data', async () => {
    const rendered = await renderServerElement('holder-el', {}, { secret, customElements: elementHolding(() => ['a', 'b']) });
    expect(rendered.html).toContain('ok');
  });
});
