import { html } from 'lit';
import { describe, expect, it } from 'vitest';
import { createAsyncBoundary, renderAsync } from '../src/index.js';

async function stream(template: unknown, options: Parameters<typeof renderAsync>[1] = {}): Promise<string> {
  let out = '';
  for await (const chunk of renderAsync(template as never, options)) out += chunk;
  return out;
}

describe('async boundary failure handling', () => {
  it('renders the boundary fallback in place of a failed boundary and reports the error', async () => {
    const errors: string[] = [];
    const failing = createAsyncBoundary(Promise.reject(new Error('db down')), html`<i>loading</i>`, { errorFallback: () => html`<b>try again later</b>` });
    const out = await stream(html`<main>${failing}</main>`, { onError: (err, info) => errors.push(`${info.phase}:${(err as Error).message}`) });

    expect(out).toContain('try again later');
    expect(errors).toEqual(['asyncBoundary:db down']);
  });

  it('keeps streaming the other boundaries when a fallback itself throws, and reports both failures', async () => {
    const errors: string[] = [];
    const broken = createAsyncBoundary(Promise.reject(new Error('db down')), html`<i>loading</i>`, {
      errorFallback: () => {
        throw new Error('fallback bug');
      },
    });
    const healthy = createAsyncBoundary(Promise.resolve(html`<b>healthy-done</b>`), html`<i>loading</i>`);
    const out = await stream(html`<main>${broken}${healthy}</main>`, { onError: (err, info) => errors.push(`${info.phase}:${(err as Error).message}`) });

    expect(out).toContain('healthy-done');
    expect(errors).toEqual(['asyncBoundary:db down', 'errorFallback:fallback bug']);
  });

  it('applies the same protection to a render-wide errorFallback', async () => {
    const errors: string[] = [];
    const broken = createAsyncBoundary(Promise.reject(new Error('db down')), html`<i>loading</i>`);
    const healthy = createAsyncBoundary(Promise.resolve(html`<b>healthy-done</b>`), html`<i>loading</i>`);
    const out = await stream(html`<main>${broken}${healthy}</main>`, {
      errorFallback: () => {
        throw new Error('fallback bug');
      },
      onError: (err, info) => errors.push(`${info.phase}:${(err as Error).message}`),
    });

    expect(out).toContain('healthy-done');
    expect(errors).toContain('errorFallback:fallback bug');
  });

  it('gives up on a boundary that never settles, shows its fallback, and still delivers the others', async () => {
    const errors: string[] = [];
    const stuck = createAsyncBoundary(new Promise(() => {}), html`<i>loading</i>`, { errorFallback: () => html`<b>timed-out</b>` });
    const healthy = createAsyncBoundary(Promise.resolve(html`<b>healthy-done</b>`), html`<i>loading</i>`);
    const out = await stream(html`<main>${stuck}${healthy}</main>`, { timeoutMs: 30, onError: (err) => errors.push((err as Error).message) });

    expect(out).toContain('healthy-done');
    expect(out).toContain('timed-out');
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/timed out after 30ms/);
  });

  it('stops streaming and releases boundaries when the request is aborted', async () => {
    const controller = new AbortController();
    const stuck = createAsyncBoundary(new Promise(() => {}), html`<i>loading</i>`);
    const started = Date.now();
    const run = (async () => {
      for await (const _chunk of renderAsync(html`<main>${stuck}</main>` as never, { signal: controller.signal, timeoutMs: 60_000 })) {
        // Draining the stream is the point: it must end on abort, not wait out the 60s deadline.
      }
    })();
    setTimeout(() => controller.abort(), 20);

    await run;
    expect(Date.now() - started).toBeLessThan(5_000);
  });
});
