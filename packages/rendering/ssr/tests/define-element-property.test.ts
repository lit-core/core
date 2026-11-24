import { describe, expect, it } from 'vitest';
import { defineElementProperty } from '../src/element-utils.js';

describe('defineElementProperty', () => {
  it('stores a value through the setter of an inherited accessor', () => {
    const seen: unknown[] = [];
    class Base {
      #value: unknown;
      get label() {
        return this.#value;
      }
      set label(next: unknown) {
        seen.push(next);
        this.#value = next;
      }
    }
    const target = new (class extends Base {})();
    defineElementProperty(target, 'label', 'a');
    expect(seen).toEqual(['a']);
    expect(target.label).toBe('a');
    expect(Object.hasOwn(target, 'label')).toBe(false);
  });

  it('defines an own data property where an inherited getter has no setter', () => {
    class Base {
      get tagName() {
        return 'FROM-SHIM';
      }
    }
    const target = new (class extends Base {})();
    defineElementProperty(target, 'tagName', 'MY-TAG');
    expect(target.tagName).toBe('MY-TAG');
    expect(Object.hasOwn(target, 'tagName')).toBe(true);
  });

  it('defines an own property over an inherited read-only data property', () => {
    const proto = Object.freeze({ kind: 'frozen' });
    const target = Object.create(proto) as { kind: string };
    defineElementProperty(target, 'kind', 'own');
    expect(target.kind).toBe('own');
  });

  it('assigns a plain property and overwrites one it already set', () => {
    const target: Record<string, unknown> = {};
    defineElementProperty(target, 'n', 1);
    defineElementProperty(target, 'n', 2);
    expect(target.n).toBe(2);
  });

  it('gives each instance its own value even though the inherited check is shared between instances', () => {
    class Base {
      get id() {
        return 'shared';
      }
    }
    class Child extends Base {}
    const first = new Child();
    const second = new Child();
    defineElementProperty(first, 'id', 'one');
    defineElementProperty(second, 'id', 'two');
    expect([first.id, second.id]).toEqual(['one', 'two']);
  });

  it('still works when the prototype changes after the first call, by falling back to defining the property', () => {
    class Base {}
    const first = new Base() as { slot?: string };
    defineElementProperty(first, 'slot', 'first');

    Object.defineProperty(Base.prototype, 'slot', { get: () => 'locked', configurable: true });
    const second = new Base() as { slot?: string };
    defineElementProperty(second, 'slot', 'second');
    expect(second.slot).toBe('second');
  });

  it('ignores a locked property instead of throwing', () => {
    const target = Object.freeze({ fixed: 1 });
    expect(() => defineElementProperty(target, 'fixed', 2)).not.toThrow();
    expect(() => defineElementProperty(target, 'fresh', 2)).not.toThrow();
    expect(target.fixed).toBe(1);
  });
});
