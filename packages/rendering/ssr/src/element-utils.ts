import { HTMLElementStub } from './environment.js';

export function isElementInstance(value: unknown): value is HTMLElementStub {
  if (value === null || typeof value !== 'object') return false;
  if (value instanceof HTMLElementStub) return true;
  const gHtmlElement = (globalThis as any).HTMLElement;
  if (typeof gHtmlElement === 'function' && value instanceof gHtmlElement) return true;
  return false;
}

/** What an inherited property does to assignment: store it, refuse it, or nothing is there at all. */
type InheritedSlot = 'assignable' | 'blocked' | 'absent';

/**
 * The answer per prototype and property. A class's prototype chain is the same for every instance,
 * and walking it level by level is the dominant cost of preparing a component with a deep hierarchy.
 */
const inheritedSlots = new WeakMap<object, Map<string, InheritedSlot>>();

function inheritedSlot(prototype: object, prop: string): InheritedSlot {
  let perProperty = inheritedSlots.get(prototype);
  if (!perProperty) {
    perProperty = new Map();
    inheritedSlots.set(prototype, perProperty);
  }
  let slot = perProperty.get(prop);
  if (slot === undefined) {
    slot = 'absent';
    for (let owner: object | null = prototype; owner !== null; owner = Object.getPrototypeOf(owner)) {
      const descriptor = Object.getOwnPropertyDescriptor(owner, prop);
      if (descriptor) {
        slot = ('value' in descriptor ? descriptor.writable === true : typeof descriptor.set === 'function') ? 'assignable' : 'blocked';
        break;
      }
    }
    perProperty.set(prop, slot);
  }
  return slot;
}

/**
 * Whether `target[prop] = value` would store the value rather than throw: a writable data property or a
 * setter on the object or its prototype chain, or a free slot on an extensible object.
 */
function acceptsAssignment(target: any, prop: string): boolean {
  const own = Object.getOwnPropertyDescriptor(target, prop);
  if (own) {
    return 'value' in own ? own.writable === true : typeof own.set === 'function';
  }
  const prototype = Object.getPrototypeOf(target);
  const slot = prototype === null ? 'absent' : inheritedSlot(prototype, prop);
  return slot === 'assignable' || (slot === 'absent' && Object.isExtensible(target));
}

/**
 * Gives `target` an own `prop` holding `value`: through a setter or plain assignment where the property allows it,
 * and as an own data property where it does not (a getter-only property inherited from a DOM shim, say).
 *
 * The slot is checked first because assigning to a getter-only property throws in strict mode, and an
 * exception per property per rendered component is slow enough to show in a profile.
 */
export function defineElementProperty(target: any, prop: string, value: any): void {
  if (acceptsAssignment(target, prop)) {
    try {
      target[prop] = value;
      return;
    } catch {
      // A setter or proxy trap refused; fall through to defining the property.
    }
  }
  try {
    Object.defineProperty(target, prop, {
      value,
      configurable: true,
      writable: true,
      enumerable: true,
    });
  } catch {
    // Ignore if property is locked
  }
}
