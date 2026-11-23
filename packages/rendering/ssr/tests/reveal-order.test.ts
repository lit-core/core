import { html } from 'lit';
import { describe, expect, it } from 'vitest';
import { type BoundaryGroup, createAsyncBoundary, renderAsync } from '../src/index.js';

/** A promise the test settles by hand. */
function gate<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/** Streams a template with three boundaries and settles them in `settleOrder`, returning the swap order. */
async function swapOrder(group: BoundaryGroup | undefined, settleOrder: Array<'A' | 'B' | 'C'>, grouped: Array<'A' | 'B' | 'C'> = ['A', 'B', 'C']): Promise<string[]> {
  const gates = { A: gate<unknown>(), B: gate<unknown>(), C: gate<unknown>() };
  const boundary = (name: 'A' | 'B' | 'C') => createAsyncBoundary(gates[name].promise, html`<i>${name}-loading</i>`, { group: grouped.includes(name) ? group : undefined });
  const template = html`<main>${boundary('A')}${boundary('B')}${boundary('C')}</main>`;

  const chunks: string[] = [];
  const done = (async () => {
    for await (const chunk of renderAsync(template)) chunks.push(chunk);
  })();

  for (const name of settleOrder) {
    gates[name].resolve(html`<b>${`${name}-done`}</b>`);
    await new Promise((r) => setTimeout(r, 15));
  }
  await done;

  return chunks
    .join('')
    .match(/[ABC]-done/g)
    ?.map((m) => m[0]) as string[];
}

describe('reveal order of async boundaries', () => {
  it('swaps ungrouped boundaries in the order they settle', async () => {
    expect(await swapOrder(undefined, ['C', 'A', 'B'])).toEqual(['C', 'A', 'B']);
  });

  it('reveals a forwards group in document order, even when later boundaries settle first', async () => {
    const group: BoundaryGroup = { id: 'list', reveal: 'forwards' };
    expect(await swapOrder(group, ['C', 'B', 'A'])).toEqual(['A', 'B', 'C']);
  });

  it('releases a forwards group as far as the settled prefix allows', async () => {
    const group: BoundaryGroup = { id: 'list', reveal: 'forwards' };
    // B settles before A, so B waits; once A settles both go, then C.
    expect(await swapOrder(group, ['B', 'A', 'C'])).toEqual(['A', 'B', 'C']);
  });

  it('holds a together group until every member has settled, then swaps them back to back', async () => {
    const group: BoundaryGroup = { id: 'cards', reveal: 'together' };
    const gates = { A: gate<unknown>(), B: gate<unknown>() };
    const template = html`${createAsyncBoundary(gates.A.promise, html`<i>a</i>`, { group })}${createAsyncBoundary(gates.B.promise, html`<i>b</i>`, { group })}`;

    const chunks: string[] = [];
    const done = (async () => {
      for await (const chunk of renderAsync(template)) chunks.push(chunk);
    })();

    gates.A.resolve(html`<b>A-done</b>`);
    await new Promise((r) => setTimeout(r, 25));
    expect(chunks.join('')).not.toContain('A-done');

    gates.B.resolve(html`<b>B-done</b>`);
    await done;
    const output = chunks.join('');
    expect(output).toContain('A-done');
    expect(output).toContain('B-done');
  });

  it('leaves boundaries outside a group free to swap as soon as they settle', async () => {
    const group: BoundaryGroup = { id: 'list', reveal: 'forwards' };
    // C is not in the group, so it swaps first even though A and B (grouped) settle after.
    expect(await swapOrder(group, ['C', 'B', 'A'], ['A', 'B'])).toEqual(['C', 'A', 'B']);
  });

  it('still accepts a bare error fallback function as before', async () => {
    const failing = Promise.reject(new Error('boom'));
    const out: string[] = [];
    for await (const chunk of renderAsync(html`${createAsyncBoundary(failing, html`<i>wait</i>`, () => html`<em>recovered</em>`)}`)) out.push(chunk);
    expect(out.join('')).toContain('recovered');
  });
});
