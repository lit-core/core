/**
 * Ultra-lightweight micro-runtime base class for Mode B native Web Components.
 * Provides microtask-batched reactive updates and DOM path resolution.
 */
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
  /**
   * Request an asynchronous update with property bitmask.
   */
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
  /**
   * Subclass-overridden reactive DOM update routine.
   */
  __update(_mask) {}
  /**
   * Ahead-of-time precomputed DOM child path resolver.
   * Eliminates runtime TreeWalker traversal by direct indexing.
   */
  __resolve(root, paths) {
    const nodes = new Array(paths.length);
    for (let i = 0; i < paths.length; i++) {
      const path = paths[i];
      let curr = root;
      for (let j = 0; j < path.length; j++) {
        curr = curr.childNodes[path[j]];
      }
      nodes[i] = curr;
    }
    return nodes;
  }
}
