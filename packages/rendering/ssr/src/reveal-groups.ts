import type { SsrPendingBoundaryEntry } from './plan-types.js';

/** A boundary that has settled and is waiting for its group to allow it into the stream. */
export interface SettledBoundary<T> {
  entry: SsrPendingBoundaryEntry;
  outcome: T;
}

/**
 * Decides when settled boundaries may be revealed, according to their group's reveal order.
 *
 * Ungrouped boundaries are released immediately. For a group, `forwards` releases the longest settled
 * prefix of the registration order, and `together` releases the whole group once nothing in it is
 * still pending. Registration is tracked so a boundary that has not settled yet holds the others back.
 */
export class RevealCoordinator<T> {
  private readonly pending = new Map<string, number[]>();
  private readonly waiting = new Map<number, SettledBoundary<T>>();

  /** Notes that a boundary exists and has not settled. Call once per boundary, in document order. */
  register(entry: SsrPendingBoundaryEntry): void {
    if (!entry.group) return;
    const ids = this.pending.get(entry.group.id) ?? [];
    ids.push(entry.id);
    this.pending.set(entry.group.id, ids);
  }

  /** Records a settled boundary and returns every boundary that may now be revealed, in reveal order. */
  settle(settled: SettledBoundary<T>): Array<SettledBoundary<T>> {
    const { entry } = settled;
    const group = entry.group;
    if (!group) return [settled];

    this.waiting.set(entry.id, settled);
    const ids = this.pending.get(group.id) ?? [];

    if (group.reveal === 'together') {
      if (ids.some((id) => !this.waiting.has(id))) return [];
      this.pending.delete(group.id);
      return this.take(ids);
    }

    const ready: number[] = [];
    while (ids.length > 0 && this.waiting.has(ids[0])) {
      ready.push(ids.shift() as number);
    }
    return this.take(ready);
  }

  private take(ids: number[]): Array<SettledBoundary<T>> {
    return ids.flatMap((id) => {
      const settled = this.waiting.get(id);
      this.waiting.delete(id);
      return settled ? [settled] : [];
    });
  }
}
