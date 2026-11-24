import { describe, expect, it } from 'vitest';
import { handleActionRequest } from '../../src/action-endpoint.js';
import { createSignedStateSnapshot } from '../../src/crypto.js';
import { ServerElement } from '../../src/element.js';
import type { PatchFrame } from '../../src/types.js';

const secret = 'streaming-test-secret-32-characters!';
const token = 'token-stream';
const hashes = { add: '00000000000000a1', plain: '00000000000000a2' };

/** Lets a test hold a loader open and release it on demand. */
function gate() {
  let release!: () => void;
  const opened = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { opened, release };
}

const control = { loaderGate: gate(), loaderShouldFail: false, loaderSetsCookie: false };

class Feed extends ServerElement {
  static properties = { count: { state: true }, summary: { state: true } };
  count = 0;
  summary = '';

  static __litPartDeps = [['count'], ['summary']];
  static __lit_loaders = { loadSummary: { writes: ['summary'], dependencies: ['count'] } };
  static __lit_actions = {
    [hashes.add]: { name: 'add', writes: ['count'], validate: (a: unknown[]) => a },
    [hashes.plain]: { name: 'plain', writes: [], validate: (a: unknown[]) => a },
  };

  async loadSummary() {
    if (control.loaderSetsCookie) (this.context as any).setCookie('late', '1');
    await control.loaderGate.opened;
    if (control.loaderShouldFail) throw new Error('summary backend down');
    this.summary = `total:${this.count}`;
  }
  async add() {
    this.count += 1;
    return 'added';
  }
  async plain() {
    return 'ok';
  }
  render() {
    return { strings: ['<b>', '</b><i>', '</i>'], values: [this.count, this.summary] };
  }
}

const customElements = { get: (tag: string) => (tag === 'feed-el' ? Feed : undefined) };

async function open(hash: string, accept = 'application/x-ndjson') {
  control.loaderGate = gate();
  control.loaderShouldFail = false;
  control.loaderSetsCookie = false;
  const state = { count: 0, summary: '' };
  const { sig } = await createSignedStateSnapshot('feed-el', state, secret, { token });
  return {
    request: () =>
      new Request(`http://localhost/_lit/a/${hash}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Lit-Action-Token': token, Accept: accept },
        body: JSON.stringify({ tag: 'feed-el', attrs: { 'data-lit-token': token }, state, sig, args: [], seq: 1 }),
      }),
  };
}

function frameReader(response: Response) {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const frames: PatchFrame[] = [];
  return {
    frames,
    /** Reads until at least `count` frames are collected, or the stream ends. */
    async readUntil(count: number) {
      while (frames.length < count) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) if (line.trim()) frames.push(JSON.parse(line));
      }
      return frames;
    },
  };
}

const call = (req: Request) => handleActionRequest(req, { env: {}, secret, customElements, devMode: true });

describe('two-phase action streaming', () => {
  it('delivers the action result before slow loaders finish', async () => {
    const { request } = await open(hashes.add);
    const response = await call(request());
    const reader = frameReader(response);

    // Phase one: the count patch, the action result and the snapshot of that state arrive while the loader is still blocked.
    const early = await reader.readUntil(3);
    expect(early).toContainEqual({ p: 0, v: 1 });
    expect(early).toContainEqual({ r: 'added' });
    const phaseOneSnapshot = early.find((f) => 's' in f) as { s: Record<string, unknown> };
    expect(phaseOneSnapshot.s.count).toBe(1);
    expect(phaseOneSnapshot.s.summary).toBe('');
    // The snapshot closes the phase: nothing from the second phase has been sent yet.
    expect(early.at(-1)).toBe(phaseOneSnapshot);

    control.loaderGate.release();
    const all = await reader.readUntil(10);
    expect(all).toContainEqual({ p: 1, v: 'total:1' });
    const snapshot = all.at(-1) as { s: Record<string, unknown> };
    expect(snapshot.s.summary).toBe('total:1');
    expect(all.filter((f) => 's' in f)).toHaveLength(2);
  });

  it('streams the signed snapshot of the delivered state when a loader fails, then the error', async () => {
    const { request } = await open(hashes.add);
    control.loaderShouldFail = true;
    const response = await call(request());
    const reader = frameReader(response);
    await reader.readUntil(3);
    control.loaderGate.release();
    const all = await reader.readUntil(10);

    // The first phase's snapshot is the only one: the failed revalidation adds none, just the error.
    const snapshots = all.filter((f) => 's' in f) as Array<{ s: Record<string, unknown> }>;
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].s.count).toBe(1);
    expect(snapshots[0].s.summary).toBe('');
    expect(all.at(-1)).toMatchObject({ e: 'summary backend down' });
  });

  it('refuses cookies set by a loader after the response has started streaming', async () => {
    const { request } = await open(hashes.add);
    control.loaderSetsCookie = true;
    const reader = frameReader(await call(request()));
    await reader.readUntil(3);
    control.loaderGate.release();
    const all = await reader.readUntil(10);

    expect(all.at(-1)).toMatchObject({ e: expect.stringContaining('already started streaming') });
  });

  it('uses a single phase when no loader needs revalidating', async () => {
    const { request } = await open(hashes.plain);
    const response = await call(request());
    const frames = await frameReader(response).readUntil(10);

    expect(frames.map((f) => Object.keys(f)[0])).toEqual(['r', 's']);
  });

  it('keeps the non-streaming JSON transport working with loaders finishing first', async () => {
    const { request } = await open(hashes.add, 'application/json');
    control.loaderGate.release();
    const response = await call(request());
    const frames = (await response.json()) as PatchFrame[];

    expect(frames).toContainEqual({ p: 1, v: 'total:1' });
    expect(frames).toContainEqual({ r: 'added' });
    expect((frames.at(-1) as { s: Record<string, unknown> }).s.summary).toBe('total:1');
  });
});
