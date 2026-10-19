/**
 * Self-contained in-memory source for virtual:lit-core/native-runtime.
 * Bundles the NativeElement microtask-batched base class and keyed list reconciler.
 */
export const NATIVE_RUNTIME_SOURCE = `
export class NativeElement extends HTMLElement {
  static observedAttributes = [];
  __dirty = 0;
  __scheduled = false;

  constructor() {
    super();
    if (!this.shadowRoot) {
      this.attachShadow({ mode: 'open' });
    }
  }

  requestUpdate(bit = -1) {
    this.__dirty |= bit;
    if (!this.__scheduled) {
      this.__scheduled = true;
      queueMicrotask(() => {
        this.__scheduled = false;
        const mask = this.__dirty;
        this.__dirty = 0;
        this.__update(mask);
      });
    }
  }

  __update(_mask) {}
}

export function reconcile(container, marker, items, keyFn, renderFn, cache) {
  const newKeys = new Set();
  let before = marker;

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const key = keyFn(item);
    newKeys.add(key);

    let entry = cache.get(key);
    if (!entry) {
      const node = renderFn(item);
      entry = { node, item };
      cache.set(key, entry);
    }

    if (entry.node.previousSibling !== before) {
      container.insertBefore(entry.node, before.nextSibling);
    }
    before = entry.node;
  }

  for (const [key, entry] of cache) {
    if (!newKeys.has(key)) {
      if (entry.node.parentNode) {
        entry.node.parentNode.removeChild(entry.node);
      }
      cache.delete(key);
    }
  }
}
`;
