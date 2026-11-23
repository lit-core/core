/**
 * Single-use enforcement for signed state snapshots.
 *
 * A snapshot is signed, not stored, so on its own it can be replayed at its own sequence number until
 * it expires. A guard closes that window: the endpoint claims each snapshot's signature before running
 * the action, and a signature can be claimed once. The browser runtime already runs one element's
 * actions in order and sends each the snapshot the previous one returned, so honest traffic never
 * reuses a signature.
 *
 * The store must be shared by every isolate that serves actions (a Durable Object, KV with an atomic
 * add, Redis `SET NX`). An in-process store only protects a single isolate.
 */
export interface ReplayGuard {
  /**
   * Records `signature` as used for `ttlMs` milliseconds.
   * Resolves `true` if this is its first use and `false` if it was already claimed.
   * Reject to fail closed when the store is unavailable.
   */
  claim(signature: string, ttlMs: number): Promise<boolean>;
}

/**
 * An in-memory `ReplayGuard` for development, tests and single-isolate deployments.
 * Entries expire with their snapshot, so memory stays bounded by the signing TTL.
 */
export function createMemoryReplayGuard(now: () => number = Date.now): ReplayGuard {
  const claimed = new Map<string, number>();

  return {
    async claim(signature, ttlMs) {
      const current = now();
      // Entries sit in claim order and snapshots share a signing TTL, so expiry order matches it: sweep
      // from the oldest and stop at the first live entry, which keeps each claim cheap however many are held.
      for (const [key, expiresAt] of claimed) {
        if (expiresAt > current) break;
        claimed.delete(key);
      }
      if (claimed.has(signature)) return false;
      claimed.set(signature, current + ttlMs);
      return true;
    },
  };
}

/** Milliseconds until a signature (`<expiresAt>.<hmac>`) expires, never below one. */
export function remainingTtlMs(signature: string, now: number = Date.now()): number {
  const expiresAt = Number(signature.split('.', 1)[0]);
  return Number.isFinite(expiresAt) ? Math.max(1, expiresAt - now) : 1;
}
