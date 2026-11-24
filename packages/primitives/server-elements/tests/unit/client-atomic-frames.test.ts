import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const applied: unknown[][] = [];
vi.mock('../../src/client-runtime/patch.js', () => ({
  executePatches: (_host: unknown, frames: unknown) => {
    applied.push(Array.isArray(frames) ? [...frames] : [frames]);
  },
}));

const { dispatchServerAction } = await import('../../src/client-runtime/dispatch.js');

const encoder = new TextEncoder();

/** An NDJSON response that delivers `frames` and then either ends cleanly or breaks like a dropped connection. */
function ndjson(frames: unknown[], ending: 'clean' | 'dropped'): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const frame of frames) controller.enqueue(encoder.encode(`${JSON.stringify(frame)}\n`));
      if (ending === 'clean') controller.close();
    },
    pull(controller) {
      if (ending === 'dropped') controller.error(new TypeError('network connection lost'));
    },
  });
  return new Response(body, { status: 200, headers: { 'Content-Type': 'application/x-ndjson' } });
}

const patch = (p: number, v: string) => ({ p, v });
const snapshot = (sig: string) => ({ s: { n: 1 }, sig, sq: 1 });

describe('a response is applied only as far as its snapshots vouch for', () => {
  const originalFetch = globalThis.fetch;
  const host = () =>
    ({
      tagName: 'my-counter',
      getAttribute: () => null,
      actionState: { setPending: vi.fn(), setSuccess: vi.fn(), setError: vi.fn() },
    }) as never;

  const respondWith = (response: Response) => {
    globalThis.fetch = vi.fn(async () => response) as never;
  };

  beforeEach(() => {
    applied.length = 0;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('applies the patches together with the snapshot that follows them, in one step', async () => {
    respondWith(ndjson([patch(0, 'a'), patch(1, 'b'), { r: 'ok' }, snapshot('sig-1')], 'clean'));
    expect(await dispatchServerAction(host(), 'act')).toBe('ok');
    expect(applied).toHaveLength(1);
    expect(applied[0]).toEqual([patch(0, 'a'), patch(1, 'b'), { r: 'ok' }, snapshot('sig-1')]);
  });

  it('does not apply patches whose snapshot never arrived because the connection dropped', async () => {
    respondWith(ndjson([patch(0, 'a'), patch(1, 'b')], 'dropped'));
    await expect(dispatchServerAction(host(), 'act')).rejects.toThrow('network connection lost');
    expect(applied).toEqual([]);
  });

  it('keeps a phase that was fully delivered and drops the one that was cut off', async () => {
    respondWith(ndjson([patch(0, 'first'), { r: 'ok' }, snapshot('sig-1'), patch(1, 'second')], 'dropped'));
    await expect(dispatchServerAction(host(), 'act')).rejects.toThrow('network connection lost');
    expect(applied).toHaveLength(1);
    expect(applied[0]).toContainEqual(patch(0, 'first'));
    expect(applied.flat()).not.toContainEqual(patch(1, 'second'));
  });

  it('applies the snapshot of a failed action before reporting the failure', async () => {
    respondWith(ndjson([snapshot('sig-fresh'), { e: 'Out of stock', code: 'CONFLICT' }], 'clean'));
    await expect(dispatchServerAction(host(), 'act')).rejects.toThrow('Out of stock');
    expect(applied).toEqual([[snapshot('sig-fresh')]]);
  });

  it('still applies a complete response that carries no snapshot at all', async () => {
    respondWith(ndjson([patch(0, 'a'), { r: 'ok' }], 'clean'));
    expect(await dispatchServerAction(host(), 'act')).toBe('ok');
    expect(applied.flat()).toContainEqual(patch(0, 'a'));
  });
});
