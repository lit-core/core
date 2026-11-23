import { html } from 'lit';
import { describe, expect, it } from 'vitest';
import { computePartPatches, stateBaseline } from '../../src/patches/compute.js';

function patchFor(values: unknown[], deps: string[][] = values.map(() => ['v'])) {
  class El {
    static __litPartDeps = deps;
    v = 1;
    render() {
      return { strings: values.map(() => ''), values };
    }
  }
  return computePartPatches({ instance: new El(), ElementClass: El, baseline: stateBaseline({ v: 0 }) }).frames;
}

describe('part frames for non-scalar values', () => {
  it('sends an array of templates as a rendered fragment, not as a scalar', () => {
    const items = ['a', 'b'].map((x) => html`<li>${x}</li>`);
    const [frame] = patchFor([items]) as any[];

    expect(frame.v).toBeUndefined();
    expect(frame.f.html).toContain('<li>');
    expect(frame.f.html).toContain('a');
    expect(frame.f.html).toContain('b');
  });

  it('renders an empty array as an empty fragment so the old content is cleared', () => {
    const [frame] = patchFor([[]]) as any[];
    expect(frame.f.html).toBe('');
  });

  it('renders an array of strings as escaped text', () => {
    const [frame] = patchFor([['<b>', 'x']]) as any[];
    expect(frame.f.html).toContain('&lt;b&gt;');
    expect(frame.f.html).not.toContain('<b>');
  });

  it('renders any other iterable of templates', () => {
    const set = new Set([html`<i>one</i>`, html`<i>two</i>`]);
    const [frame] = patchFor([set]) as any[];
    expect(frame.f.html).toContain('<i>one</i>');
    expect(frame.f.html).toContain('<i>two</i>');
  });

  it('keeps plain scalars as scalar frames', () => {
    expect(patchFor(['text', 5, null])).toEqual([
      { p: 0, v: 'text' },
      { p: 1, v: 5 },
      { p: 2, v: null },
    ]);
  });
});
