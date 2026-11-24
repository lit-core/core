/**
 * A small least-recently-used map. Derived keys are cached per secret, and a process that rotates or
 * derives secrets per tenant would otherwise grow the cache for as long as it runs.
 */
export class BoundedCache<K, V> {
  private readonly entries = new Map<K, V>();

  constructor(private readonly capacity: number) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new RangeError('BoundedCache capacity must be a positive integer');
    }
  }

  get size(): number {
    return this.entries.size;
  }

  get(key: K): V | undefined {
    const value = this.entries.get(key);
    if (value !== undefined) {
      // Re-insert so the entry counts as the most recently used.
      this.entries.delete(key);
      this.entries.set(key, value);
    }
    return value;
  }

  set(key: K, value: V): void {
    this.entries.delete(key);
    this.entries.set(key, value);
    if (this.entries.size > this.capacity) {
      const oldest = this.entries.keys().next();
      if (!oldest.done) this.entries.delete(oldest.value);
    }
  }

  delete(key: K): void {
    this.entries.delete(key);
  }
}

/** Enough for a deployment's own secret, its previous one during rotation, and a few more. */
export const KEY_CACHE_CAPACITY = 16;
