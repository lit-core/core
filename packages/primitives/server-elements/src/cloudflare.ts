/**
 * A replay guard for Cloudflare Workers, backed by Durable Objects.
 *
 * The in-memory guard (`createMemoryReplayGuard`) only protects one isolate, and a deployment runs many.
 * A Durable Object is a single instance for the whole deployment that handles one request at a time
 * between storage calls, which is what a single-use check needs: of any number of simultaneous requests
 * carrying one signature, exactly one is first.
 *
 * Export `ReplayGuardStore` from the worker entry and bind it as a Durable Object namespace:
 *
 * ```ts
 * export { ReplayGuardStore } from '@lit-core/server-elements/cloudflare';
 *
 * handleActionRequest(request, { env, secret, replayGuard: createDurableObjectReplayGuard(env.REPLAY_GUARD) });
 * ```
 *
 * This module declares the few Durable Object types it uses itself, so it needs no Cloudflare type package.
 */
import type { ReplayGuard } from './replay-guard.js';

interface StorageLike {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
  delete(keys: string[]): Promise<number>;
  list<T>(options?: { limit?: number }): Promise<Map<string, T>>;
}

/** The part of a Durable Object namespace binding the guard uses. */
export interface ReplayGuardNamespace {
  idFromName(name: string): unknown;
  get(id: unknown): { fetch(url: string, init?: RequestInit): Promise<Response> };
}

export interface DurableObjectReplayGuardOptions {
  /**
   * How many Durable Objects share the claims. A signature always goes to the same one, so single use
   * holds, while claims for different signatures do not queue behind one another.
   * @default 16
   */
  shards?: number;
}

const DEFAULT_SHARDS = 16;
const MAX_SHARDS = 1024;
const SWEEP_EVERY = 50;
const SWEEP_BATCH = 100;

/** The signature's HMAC is uniformly distributed, so its tail picks a shard evenly. */
function shardOf(signature: string, shards: number): number {
  const tail = Number.parseInt(signature.slice(-8), 16);
  return Number.isFinite(tail) ? tail % shards : 0;
}

/** A `ReplayGuard` over a Durable Object namespace, shared by every isolate that binds it. */
export function createDurableObjectReplayGuard(namespace: ReplayGuardNamespace, options: DurableObjectReplayGuardOptions = {}): ReplayGuard {
  const shards = options.shards ?? DEFAULT_SHARDS;
  if (!Number.isInteger(shards) || shards < 1 || shards > MAX_SHARDS) {
    throw new RangeError(`createDurableObjectReplayGuard: shards must be an integer from 1 to ${MAX_SHARDS}, got ${shards}`);
  }

  return {
    async claim(signature, ttlMs) {
      const stub = namespace.get(namespace.idFromName(`replay-guard-${shardOf(signature, shards)}`));
      const response = await stub.fetch('http://replay-guard/claim', { method: 'POST', body: JSON.stringify({ signature, ttlMs }) });
      // A store that cannot answer must not let a replay through, so the endpoint fails closed on this.
      if (!response.ok) throw new Error(`Replay guard store answered ${response.status}`);
      return ((await response.json()) as { first: boolean }).first;
    },
  };
}

/** The Durable Object class that remembers which signatures were used. Export it from the worker entry. */
export class ReplayGuardStore {
  private claims = 0;

  constructor(private readonly state: { storage: StorageLike }) {}

  async fetch(request: Request): Promise<Response> {
    const { signature, ttlMs } = (await request.json()) as { signature: string; ttlMs: number };
    const now = Date.now();
    const expiresAt = await this.state.storage.get<number>(signature);
    if (expiresAt !== undefined && expiresAt > now) {
      return Response.json({ first: false });
    }
    await this.state.storage.put(signature, now + ttlMs);

    if (++this.claims % SWEEP_EVERY === 0) {
      const stored = await this.state.storage.list<number>({ limit: SWEEP_BATCH });
      const expired = [...stored].filter(([, until]) => until <= now).map(([key]) => key);
      if (expired.length > 0) await this.state.storage.delete(expired);
    }
    return Response.json({ first: true });
  }
}
