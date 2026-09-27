/**
 * Ultra-lightweight micro-runtime base class for Mode B native Web Components.
 * Provides microtask-batched reactive updates and DOM path resolution.
 */
export class NativeElement extends HTMLElement {
  static observedAttributes: string[] = [];
  protected __dirty: number = 0;
  protected __scheduled: boolean = false;

  constructor() {
    super();
    if (!this.shadowRoot) {
      this.attachShadow({ mode: 'open' });
    }
  }

  /**
   * Request an asynchronous update with property bitmask.
   */
  requestUpdate(bit: number = -1): void {
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
  protected __update(_mask: number): void {}

  /**
   * Ahead-of-time precomputed DOM child path resolver.
   * Eliminates runtime TreeWalker traversal by direct indexing.
   */
  protected __resolve(root: Node, paths: number[][]): Node[] {
    const nodes: Node[] = new Array(paths.length);
    for (let i = 0; i < paths.length; i++) {
      const path = paths[i];
      let curr: Node = root;
      for (let j = 0; j < path.length; j++) {
        curr = curr.childNodes[path[j]];
      }
      nodes[i] = curr;
    }
    return nodes;
  }
}
