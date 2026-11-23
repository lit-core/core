export interface WriteTracker {
  /** Names of properties assigned while the tracker was installed. */
  readonly written: ReadonlySet<string>;
  /** Removes the interceptors and restores each property to its pre-install shape, keeping the latest value. */
  restore(): void;
}

function findPrototypeAccessor(proto: object | null, prop: string): PropertyDescriptor | undefined {
  let cursor = proto;
  while (cursor && cursor !== Object.prototype) {
    const desc = Object.getOwnPropertyDescriptor(cursor, prop);
    if (desc && (typeof desc.get === 'function' || typeof desc.set === 'function')) {
      return desc;
    }
    cursor = Object.getPrototypeOf(cursor);
  }
  return undefined;
}

/**
 * Installs per-instance accessors that record which of `props` an action assigns to.
 *
 * Structural comparison alone cannot tell "assigned the same value" from "never touched", and
 * cannot see in-place mutation of a shared object. Write tracking supplies the missing signal.
 * Prototype accessors (Lit reactive properties) are preserved and invoked, so update scheduling
 * and attribute reflection keep working while tracking is active.
 */
export function trackPropertyWrites(instance: any, props: Iterable<string>, seedWritten: Iterable<string> = []): WriteTracker {
  const written = new Set<string>(seedWritten);
  const restorers: Array<() => void> = [];
  const proto = Object.getPrototypeOf(instance);

  for (const prop of props) {
    const ownDesc = Object.getOwnPropertyDescriptor(instance, prop);
    if (ownDesc && !ownDesc.configurable) continue;

    const accessor = ownDesc ? (ownDesc.get || ownDesc.set ? ownDesc : undefined) : findPrototypeAccessor(proto, prop);
    let currentValue = accessor?.get ? undefined : ownDesc ? ownDesc.value : instance[prop];

    try {
      Object.defineProperty(instance, prop, {
        configurable: true,
        enumerable: ownDesc ? ownDesc.enumerable : true,
        get() {
          return accessor?.get ? accessor.get.call(this) : currentValue;
        },
        set(next: unknown) {
          written.add(prop);
          if (accessor?.set) {
            accessor.set.call(this, next);
          } else {
            currentValue = next;
          }
        },
      });
    } catch {
      continue;
    }

    restorers.push(() => {
      try {
        if (ownDesc) {
          if ('value' in ownDesc) {
            Object.defineProperty(instance, prop, { ...ownDesc, value: accessor?.get ? accessor.get.call(instance) : currentValue });
          } else {
            Object.defineProperty(instance, prop, ownDesc);
          }
        } else if (accessor) {
          delete instance[prop];
        } else if (written.has(prop) || currentValue !== undefined) {
          Object.defineProperty(instance, prop, { value: currentValue, writable: true, enumerable: true, configurable: true });
        } else {
          delete instance[prop];
        }
      } catch {}
    });
  }

  return {
    written,
    restore() {
      for (let i = restorers.length - 1; i >= 0; i--) {
        restorers[i]();
      }
    },
  };
}
