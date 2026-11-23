import { html, LitElement } from 'lit';
import { beforeAll, describe, expect, it } from 'vitest';
import { installIsolateGlobals, renderToStream } from '../src/index.js';

const ITEMS = 2000;

/** An iterable that records how far the renderer has pulled it. */
function trackedItems(label: string) {
  const state = { pulled: 0 };
  const iterable = {
    *[Symbol.iterator]() {
      for (let i = 0; i < ITEMS; i++) {
        state.pulled++;
        yield html`<li>${`${label}-${i}`}</li>`;
      }
    },
  };
  return { state, iterable };
}

class StreamedList extends LitElement {
  static properties = { source: { attribute: false } };
  declare source: Iterable<unknown>;
  render() {
    return html`<ul>${this.source}</ul>`;
  }
}

async function readUntil(stream: ReadableStream<Uint8Array>, predicate: (text: string) => boolean) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let text = '';
  let chunks = 0;
  while (!predicate(text)) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks++;
    text += decoder.decode(value, { stream: true });
  }
  await reader.cancel();
  return { text, chunks };
}

describe('incremental streaming', () => {
  beforeAll(() => {
    installIsolateGlobals();
    customElements.get('streamed-list') ?? customElements.define('streamed-list', StreamedList);
  });

  it('does not render the whole page before the first chunk is delivered', async () => {
    const { state, iterable } = trackedItems('page');
    const { text, chunks } = await readUntil(renderToStream(html`<main><ul>${iterable}</ul></main>`), (t) => t.includes('page-3<'));

    expect(text).toContain('page-3<');
    expect(chunks).toBeGreaterThan(1);
    expect(state.pulled).toBeLessThan(ITEMS / 10);
  });

  it('streams the children of a component shadow root as they render, instead of buffering the subtree', async () => {
    const { state, iterable } = trackedItems('shadow');
    const template = html`<streamed-list .source=${iterable}></streamed-list>`;
    const { text } = await readUntil(renderToStream(template), (t) => t.includes('shadow-3<'));

    expect(text).toContain('<template shadowrootmode="open">');
    expect(text).toContain('shadow-3<');
    expect(state.pulled).toBeLessThan(ITEMS / 10);
  });

  it('delivers everything once the stream is read to the end', async () => {
    const { state, iterable } = trackedItems('all');
    const { text } = await readUntil(renderToStream(html`<ul>${iterable}</ul>`), (t) => t.includes(`all-${ITEMS - 1}<`));

    expect(text).toContain(`all-${ITEMS - 1}<`);
    expect(state.pulled).toBe(ITEMS);
  });
});
