import { describe, expect, it } from 'vitest';
import { handleActionRequest } from '../../src/action-endpoint.js';
import { ActionError } from '../../src/action-error.js';
import { createSignedStateSnapshot } from '../../src/crypto.js';
import { ServerElement } from '../../src/element.js';
import { createMemoryReplayGuard, remainingTtlMs } from '../../src/replay-guard.js';

const secret = 'replay-guard-test-secret-32-chars!!!';
const hash = '00000000000000d1';
const strictHash = '00000000000000d2';
const failingHash = '00000000000000d3';
let runs = 0;

class Counter extends ServerElement {
  static properties = { count: { state: true } };
  count = 0;
  static __lit_actions = {
    [hash]: { name: 'bump', writes: ['count'], validate: (a: unknown[]) => a },
    [failingHash]: { name: 'rejectsWith', writes: [], validate: (a: unknown[]) => a },
    [strictHash]: {
      name: 'strict',
      writes: [],
      validate: (a: unknown[]) => {
        if (a.length > 0) throw new TypeError('no arguments expected');
        return a;
      },
    },
  };
  async bump() {
    runs++;
    this.count += 1;
  }
  async rejectsWith() {
    throw new ActionError('CONFLICT', 'Out of stock');
  }
  async strict() {
    runs++;
  }
  render() {
    return { strings: ['<i>', '</i>'], values: [this.count] };
  }
}

const customElements = { get: (tag: string) => (tag === 'counter-el' ? Counter : undefined) };

async function snapshot(token: string) {
  const state = { count: 0 };
  const { sig } = await createSignedStateSnapshot('counter-el', state, secret, { token });
  return { state, sig, token };
}

const post = ({ state, sig, token }: Awaited<ReturnType<typeof snapshot>>, actionHash = hash, args: unknown[] = []) =>
  new Request(`http://localhost/_lit/a/${actionHash}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Lit-Action-Token': token },
    body: JSON.stringify({ tag: 'counter-el', attrs: { 'data-lit-token': token }, state, sig, args, seq: 1 }),
  });

describe('replay guard', () => {
  it('rejects the second use of a snapshot and never runs the action again', async () => {
    runs = 0;
    const replayGuard = createMemoryReplayGuard();
    const options = { env: {}, secret, customElements, replayGuard };
    const snap = await snapshot('tok-a');

    expect((await handleActionRequest(post(snap), options)).status).toBe(200);
    const replay = await handleActionRequest(post(snap), options);

    expect(replay.status).toBe(409);
    expect(await replay.json()).toMatchObject({ code: 'STATE_REPLAYED' });
    expect(runs).toBe(1);
  });

  it('accepts distinct snapshots', async () => {
    runs = 0;
    const options = { env: {}, secret, customElements, replayGuard: createMemoryReplayGuard() };
    expect((await handleActionRequest(post(await snapshot('tok-b')), options)).status).toBe(200);
    expect((await handleActionRequest(post(await snapshot('tok-c')), options)).status).toBe(200);
    expect(runs).toBe(2);
  });

  it('does not consume a snapshot that failed signature checks', async () => {
    const replayGuard = createMemoryReplayGuard();
    const options = { env: {}, secret, customElements, replayGuard };
    const snap = await snapshot('tok-d');
    const tampered = { ...snap, state: { count: 99 } };

    expect((await handleActionRequest(post(tampered), options)).status).toBe(403);
    expect((await handleActionRequest(post(snap), options)).status).toBe(200);
  });

  it('does not consume a snapshot when the arguments fail validation, so the corrected retry works', async () => {
    runs = 0;
    const options = { env: {}, secret, customElements, replayGuard: createMemoryReplayGuard() };
    const snap = await snapshot('tok-g');

    const rejected = await handleActionRequest(post(snap, strictHash, ['unexpected']), options);
    expect(rejected.status).toBe(400);
    expect(await rejected.json()).toMatchObject({ code: 'VALIDATION_ERROR' });
    expect((await handleActionRequest(post(snap, strictHash, []), options)).status).toBe(200);
  });

  it('does not consume a snapshot presented for an action the element does not have', async () => {
    const options = { env: {}, secret, customElements, replayGuard: createMemoryReplayGuard() };
    const snap = await snapshot('tok-h');

    expect((await handleActionRequest(post(snap, '00000000000000ff'), options)).status).toBe(404);
    expect((await handleActionRequest(post(snap), options)).status).toBe(200);
  });

  it('hands the browser a fresh snapshot when an action fails, so the next action is not rejected as replayed', async () => {
    runs = 0;
    const options = { env: {}, secret, customElements, replayGuard: createMemoryReplayGuard() };
    const snap = await snapshot('tok-i');
    const failing = new Request(`http://localhost/_lit/a/${failingHash}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/x-ndjson', 'X-Lit-Action-Token': snap.token },
      body: JSON.stringify({ tag: 'counter-el', attrs: { 'data-lit-token': snap.token }, state: snap.state, sig: snap.sig, args: [], seq: 1 }),
    });

    const frames = (await (await handleActionRequest(failing, options)).text())
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    expect(frames.map((f) => ('s' in f ? 'snapshot' : 'e' in f ? 'error' : 'other'))).toEqual(['snapshot', 'error']);
    expect(frames[1]).toMatchObject({ code: 'CONFLICT', e: 'Out of stock' });

    const next = await handleActionRequest(
      new Request(`http://localhost/_lit/a/${hash}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Lit-Action-Token': snap.token },
        body: JSON.stringify({ tag: 'counter-el', attrs: { 'data-lit-token': snap.token }, state: frames[0].s, sig: frames[0].sig, args: [], seq: 2, snapshotSeq: frames[0].sq }),
      }),
      options,
    );
    expect(next.status).toBe(200);
    expect(runs).toBe(1);
  });

  it('fails closed when the guard store is unavailable', async () => {
    const replayGuard = { claim: async () => Promise.reject(new Error('store down')) };
    await expect(handleActionRequest(post(await snapshot('tok-e')), { env: {}, secret, customElements, replayGuard })).rejects.toThrow('store down');
  });

  it('leaves snapshots replayable when no guard is configured', async () => {
    const options = { env: {}, secret, customElements };
    const snap = await snapshot('tok-f');
    expect((await handleActionRequest(post(snap), options)).status).toBe(200);
    expect((await handleActionRequest(post(snap), options)).status).toBe(200);
  });
});

describe('createMemoryReplayGuard', () => {
  it('forgets a signature once its snapshot has expired', async () => {
    let clock = 1_000;
    const guard = createMemoryReplayGuard(() => clock);
    expect(await guard.claim('sig', 500)).toBe(true);
    expect(await guard.claim('sig', 500)).toBe(false);
    clock += 501;
    expect(await guard.claim('sig', 500)).toBe(true);
  });
});

describe('createMemoryReplayGuard sweeping', () => {
  it('releases expired signatures while keeping live ones claimed', async () => {
    let clock = 0;
    const guard = createMemoryReplayGuard(() => clock);
    expect(await guard.claim('a', 100)).toBe(true);
    clock = 50;
    expect(await guard.claim('b', 100)).toBe(true);
    clock = 120;
    expect(await guard.claim('c', 100)).toBe(true);
    expect(await guard.claim('b', 100)).toBe(false);
    expect(await guard.claim('a', 100)).toBe(true);
  });
});

describe('remainingTtlMs', () => {
  it('reads the expiry out of a signature and never returns less than one', () => {
    expect(remainingTtlMs('5000.abcd', 1000)).toBe(4000);
    expect(remainingTtlMs('500.abcd', 1000)).toBe(1);
    expect(remainingTtlMs('garbage', 1000)).toBe(1);
  });
});
