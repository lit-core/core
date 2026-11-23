import { describe, expect, it } from 'vitest';
import { trackPropertyWrites } from '../../../src/endpoint/write-tracker.js';

describe('trackPropertyWrites', () => {
  it('records assignments to tracked properties, including ones that assign the same value', () => {
    const instance = { count: 1, name: 'a', other: 0 };
    const tracker = trackPropertyWrites(instance, ['count', 'name']);
    instance.count = 1;
    instance.other = 5;
    expect([...tracker.written]).toEqual(['count']);
    tracker.restore();
  });

  it('does not record reads or in-place mutation of a value', () => {
    const instance = { items: [1] };
    const tracker = trackPropertyWrites(instance, ['items']);
    instance.items.push(2);
    expect(tracker.written.size).toBe(0);
    tracker.restore();
  });

  it('keeps the latest value and a plain data property after restore', () => {
    const instance = { count: 1 };
    const tracker = trackPropertyWrites(instance, ['count']);
    instance.count = 7;
    tracker.restore();
    expect(Object.getOwnPropertyDescriptor(instance, 'count')).toMatchObject({ value: 7, writable: true, enumerable: true, configurable: true });
    instance.count = 8;
    expect(tracker.written.has('count')).toBe(true);
    expect(instance.count).toBe(8);
  });

  it('calls through to a prototype accessor and leaves it in place after restore', () => {
    const calls: unknown[] = [];
    class Reactive {
      #value = 0;
      get value() {
        return this.#value;
      }
      set value(next: number) {
        calls.push(next);
        this.#value = next;
      }
    }
    const instance = new Reactive();
    const tracker = trackPropertyWrites(instance, ['value']);
    instance.value = 3;
    expect(instance.value).toBe(3);
    expect(calls).toEqual([3]);
    expect(tracker.written.has('value')).toBe(true);
    tracker.restore();
    expect(Object.hasOwn(instance, 'value')).toBe(false);
    instance.value = 4;
    expect(calls).toEqual([3, 4]);
  });

  it('seeds the written set, for loaders that wrote before the action started', () => {
    const instance = { a: 1, b: 2 };
    const tracker = trackPropertyWrites(instance, ['a', 'b'], ['a']);
    expect([...tracker.written]).toEqual(['a']);
    tracker.restore();
  });

  it('skips non-configurable properties instead of throwing', () => {
    const instance = {} as { fixed: number };
    Object.defineProperty(instance, 'fixed', { value: 1, configurable: false, writable: true });
    const tracker = trackPropertyWrites(instance, ['fixed']);
    instance.fixed = 2;
    expect(tracker.written.size).toBe(0);
    tracker.restore();
  });

  it('removes the interceptor for a property that was never defined and never written', () => {
    const instance = {} as { later?: number };
    const tracker = trackPropertyWrites(instance, ['later']);
    tracker.restore();
    expect(Object.hasOwn(instance, 'later')).toBe(false);
  });
});
