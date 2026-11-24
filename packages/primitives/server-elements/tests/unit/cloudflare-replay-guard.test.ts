import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDurableObjectReplayGuard, ReplayGuardStore } from '../../src/cloudflare.js';

/** In-memory stand-in for Durable Object storage. */
function fakeStorage() {
  const entries = new Map<string, unknown>();
  return {
    entries,
    async get<T>(key: string) {
      return entries.get(key) as T | undefined;
    },
    async put<T>(key: string, value: T) {
      entries.set(key, value);
    },
    async delete(keys: string[]) {
      return keys.filter((key) => entries.delete(key)).length;
    },
    async list<T>(options?: { limit?: number }) {
      return new Map([...entries].slice(0, options?.limit)) as Map<string, T>;
    },
  };
}

/**
 * A namespace whose objects are real `ReplayGuardStore` instances, one per name, as Durable Objects are.
 * A Durable Object does not deliver another request between its storage calls, so requests to one object
 * run one after another here too; the store's single-use guarantee rests on that.
 */
function fakeNamespace() {
  const stores = new Map<string, { store: ReplayGuardStore; storage: ReturnType<typeof fakeStorage>; queue: Promise<unknown> }>();
  return {
    stores,
    idFromName: (name: string) => name,
    get(id: unknown) {
      const name = String(id);
      let entry = stores.get(name);
      if (!entry) {
        const storage = fakeStorage();
        entry = { store: new ReplayGuardStore({ storage }), storage, queue: Promise.resolve() };
        stores.set(name, entry);
      }
      const object = entry;
      return {
        fetch(url: string, init?: RequestInit) {
          const answer = object.queue.then(() => object.store.fetch(new Request(url, init)));
          object.queue = answer.catch(() => undefined);
          return answer;
        },
      };
    },
  };
}

const signature = (tail: string) => `1795460550986.${'0'.repeat(56)}${tail}`;

describe('ReplayGuardStore', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('answers first for a new signature and not first for a repeat', async () => {
    const guard = createDurableObjectReplayGuard(fakeNamespace());
    expect(await guard.claim(signature('0000000a'), 60_000)).toBe(true);
    expect(await guard.claim(signature('0000000a'), 60_000)).toBe(false);
  });

  it('lets exactly one of many simultaneous claims for one signature win', async () => {
    const guard = createDurableObjectReplayGuard(fakeNamespace());
    const results = await Promise.all(Array.from({ length: 20 }, () => guard.claim(signature('0000000b'), 60_000)));
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it('releases a signature once its time to live has passed', async () => {
    const guard = createDurableObjectReplayGuard(fakeNamespace());
    expect(await guard.claim(signature('0000000c'), 1_000)).toBe(true);
    vi.setSystemTime(1_000_000 + 1_001);
    expect(await guard.claim(signature('0000000c'), 1_000)).toBe(true);
  });

  it('sweeps expired signatures out of storage so it does not grow without bound', async () => {
    const namespace = fakeNamespace();
    const guard = createDurableObjectReplayGuard(namespace, { shards: 1 });
    for (let index = 0; index < 49; index++) await guard.claim(signature(index.toString(16).padStart(8, '0')), 1_000);
    vi.setSystemTime(1_000_000 + 5_000);
    // The fiftieth claim triggers the sweep, after which only live entries remain.
    await guard.claim(signature('ffffffff'), 60_000);
    const { storage } = [...namespace.stores.values()][0];
    expect(storage.entries.size).toBe(1);
  });
});

describe('createDurableObjectReplayGuard', () => {
  it('sends one signature to the same shard every time and spreads different ones across shards', async () => {
    const namespace = fakeNamespace();
    const guard = createDurableObjectReplayGuard(namespace, { shards: 4 });
    for (let tail = 0; tail < 64; tail++) await guard.claim(signature(tail.toString(16).padStart(8, '0')), 60_000);
    expect(namespace.stores.size).toBe(4);
    await guard.claim(signature('00000001'), 60_000);
    const total = [...namespace.stores.values()].reduce((sum, { storage }) => sum + storage.entries.size, 0);
    expect(total).toBe(64);
  });

  it('rejects a shard count that cannot work', () => {
    for (const shards of [0, -1, 1.5, 5000, Number.NaN]) {
      expect(() => createDurableObjectReplayGuard(fakeNamespace(), { shards })).toThrow(RangeError);
    }
  });

  it('fails closed when the store answers with an error', async () => {
    const namespace = { idFromName: (name: string) => name, get: () => ({ fetch: async () => new Response('down', { status: 503 }) }) };
    await expect(createDurableObjectReplayGuard(namespace).claim(signature('00000001'), 60_000)).rejects.toThrow('503');
  });
});
