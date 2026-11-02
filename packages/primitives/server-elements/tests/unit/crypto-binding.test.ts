import { describe, expect, it } from 'vitest';
import { handleActionRequest } from '../../src/action-endpoint.js';
import { buildHmacPayload, createSignedStateSnapshot, verifyStateSignature } from '../../src/crypto.js';

const SECRET = 'binding-test-secret-key-0123456789abcdef';
const TAG = 'probe-counter';

describe('signed state binding (regression for the replay and optional-token findings)', () => {
  it('rejects an old snapshot presented under any other snapshot sequence', async () => {
    const s0 = await createSignedStateSnapshot(TAG, { count: 1 }, SECRET, { seq: 0, buildId: 'build-a' });
    const base = { buildId: 'build-a', token: s0.token };

    expect(await verifyStateSignature(TAG, s0.state, s0.sig, SECRET, { ...base, seq: 0 })).toBe(true);
    for (const claimedSeq of [1, 5, 42]) {
      expect(await verifyStateSignature(TAG, s0.state, s0.sig, SECRET, { ...base, seq: claimedSeq })).toBe(false);
    }
  });

  it('rejects off-by-one sequence numbers in both directions', async () => {
    const s5 = await createSignedStateSnapshot(TAG, { count: 99 }, SECRET, { seq: 5, buildId: 'build-a' });
    const base = { buildId: 'build-a', token: s5.token };

    expect(await verifyStateSignature(TAG, s5.state, s5.sig, SECRET, { ...base, seq: 6 })).toBe(false);
    expect(await verifyStateSignature(TAG, s5.state, s5.sig, SECRET, { ...base, seq: 4 })).toBe(false);
    expect(await verifyStateSignature(TAG, s5.state, s5.sig, SECRET, { ...base, seq: 5 })).toBe(true);
  });

  it('binds the build id exactly, including the unversioned empty build id', async () => {
    const unversioned = await createSignedStateSnapshot(TAG, { n: 1 }, SECRET, { seq: 0 });
    expect(await verifyStateSignature(TAG, unversioned.state, unversioned.sig, SECRET, { token: unversioned.token, seq: 0 })).toBe(true);
    expect(await verifyStateSignature(TAG, unversioned.state, unversioned.sig, SECRET, { token: unversioned.token, seq: 0, buildId: 'dev' })).toBe(false);

    const versioned = await createSignedStateSnapshot(TAG, { n: 1 }, SECRET, { seq: 0, buildId: 'dev' });
    expect(await verifyStateSignature(TAG, versioned.state, versioned.sig, SECRET, { token: versioned.token, seq: 0 })).toBe(false);
  });

  it('requires the token and never accepts a missing, empty, or different one', async () => {
    const snap = await createSignedStateSnapshot(TAG, { n: 1 }, SECRET, { seq: 0, buildId: 'b' });
    const base = { seq: 0, buildId: 'b' };

    expect(await verifyStateSignature(TAG, snap.state, snap.sig, SECRET, { ...base, token: snap.token })).toBe(true);
    expect(await verifyStateSignature(TAG, snap.state, snap.sig, SECRET, { ...base, token: '' })).toBe(false);
    expect(await verifyStateSignature(TAG, snap.state, snap.sig, SECRET, { ...base, token: '0000000000000000' })).toBe(false);
    expect(await verifyStateSignature(TAG, snap.state, snap.sig, SECRET, base as any)).toBe(false);
  });

  it('binds public attributes but ignores data-lit and internal bookkeeping attributes', async () => {
    const snap = await createSignedStateSnapshot(TAG, { n: 1 }, SECRET, { seq: 0, publicAttrs: { 'product-id': 'sku-1' } });
    const base = { seq: 0, token: snap.token };

    expect(await verifyStateSignature(TAG, snap.state, snap.sig, SECRET, { ...base, publicAttrs: { 'product-id': 'sku-1', 'data-lit-token': snap.token } })).toBe(true);
    expect(await verifyStateSignature(TAG, snap.state, snap.sig, SECRET, { ...base, publicAttrs: { 'product-id': 'sku-2' } })).toBe(false);
    expect(await verifyStateSignature(TAG, snap.state, snap.sig, SECRET, { ...base, publicAttrs: {} })).toBe(false);
  });

  it('rejects tampered state, tampered signatures, expired snapshots, and a different secret', async () => {
    const snap = await createSignedStateSnapshot(TAG, { count: 1 }, SECRET, { seq: 0 });
    const base = { seq: 0, token: snap.token };

    expect(await verifyStateSignature(TAG, { count: 2 }, snap.sig, SECRET, base)).toBe(false);
    const [exp, hex] = snap.sig.split('.');
    const flipped = `${exp}.${hex.slice(0, -1)}${hex.endsWith('0') ? '1' : '0'}`;
    expect(await verifyStateSignature(TAG, snap.state, flipped, SECRET, base)).toBe(false);
    expect(await verifyStateSignature(TAG, snap.state, snap.sig, 'a-different-secret-key-0123456789ab', base)).toBe(false);

    const expired = await createSignedStateSnapshot(TAG, { count: 1 }, SECRET, { seq: 0, ttlMs: -1 });
    expect(await verifyStateSignature(TAG, expired.state, expired.sig, SECRET, { seq: 0, token: expired.token })).toBe(false);
  });

  it('uses length-prefixed fields so values cannot be shifted across field boundaries', () => {
    const a = buildHmacPayload('x', {}, 1, { buildId: 'a:1', seq: 0, token: '0123456789abcdef' });
    const b = buildHmacPayload('x', {}, 1, { buildId: 'a', seq: 1, token: '0123456789abcdef' });
    expect(Array.from(a)).not.toEqual(Array.from(b));
  });
});

describe('secret handling fails closed', () => {
  class Counter {
    static properties = { count: { state: true } };
    static __litActions = {};
    count = 0;
  }

  function request() {
    return new Request('http://localhost/_lit/a/0123456789abcdef', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tag: 'probe-counter', state: {}, sig: '', args: [], seq: 1 }),
    });
  }

  it('throws without a secret even when NODE_ENV is undefined (as under Cloudflare nodejs_compat)', async () => {
    const previous = process.env.NODE_ENV;
    delete process.env.NODE_ENV;
    try {
      await expect(handleActionRequest(request(), { env: {}, secret: undefined as any, registry: { get: () => Counter } })).rejects.toThrow(/Missing mandatory secret/);
    } finally {
      if (previous !== undefined) process.env.NODE_ENV = previous;
    }
  });

  it('only uses the development secret when devMode is explicitly true', async () => {
    const res = await handleActionRequest(request(), { env: {}, secret: undefined as any, devMode: true, registry: { get: () => Counter } });
    expect(res.status).toBe(403);
  });

  it('rejects well-formed signatures with tampered state or mismatched sequence in handleActionRequest', async () => {
    class BoundCounter {
      static properties = { count: { state: true } };
      static __lit_actions = {
        '0123456789abcdef': {
          name: 'inc',
          writes: ['count'],
          validate: (args: unknown[]) => args,
        },
      };
      count = 0;
      inc() {
        this.count += 1;
      }
      render() {
        return { strings: ['<span>', '</span>'], values: [this.count] };
      }
    }

    const snap = await createSignedStateSnapshot(TAG, { count: 10 }, SECRET, { seq: 0 });

    const tamperedStateReq = new Request('http://localhost/_lit/a/0123456789abcdef', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Lit-Action-Token': snap.token,
      },
      body: JSON.stringify({
        tag: TAG,
        attrs: { 'data-lit-token': snap.token },
        state: { count: 999 },
        sig: snap.sig,
        snapshotSeq: 0,
        args: [],
        seq: 1,
      }),
    });

    const resState = await handleActionRequest(tamperedStateReq, {
      env: {},
      secret: SECRET,
      registry: { get: (name: string) => (name === TAG ? BoundCounter : undefined) },
    });
    expect(resState.status).toBe(403);
    expect((await resState.json()).code).toBe('STATE_TAMPERED');

    const replayedSeqReq = new Request('http://localhost/_lit/a/0123456789abcdef', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Lit-Action-Token': snap.token,
      },
      body: JSON.stringify({
        tag: TAG,
        attrs: { 'data-lit-token': snap.token },
        state: snap.state,
        sig: snap.sig,
        snapshotSeq: 1,
        args: [],
        seq: 2,
      }),
    });

    const resSeq = await handleActionRequest(replayedSeqReq, {
      env: {},
      secret: SECRET,
      registry: { get: (name: string) => (name === TAG ? BoundCounter : undefined) },
    });
    expect(resSeq.status).toBe(403);
    expect((await resSeq.json()).code).toBe('STATE_TAMPERED');
  });
});
