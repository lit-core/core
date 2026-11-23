/** Read-only view of a custom element registry: all that rendering needs to expand elements. */
export interface CustomElementLookup {
  get(name: string): (new () => any) | undefined;
  has?(name: string): boolean;
  getRegisteredTagNames?(): Iterable<string>;
}

export interface CustomElementRegistryLike extends CustomElementLookup {
  define(name: string, ctor: new () => any): void;
}

export class IsolateCustomElementRegistry implements CustomElementRegistryLike {
  private _definitions = new Map<string, new () => any>();
  private _parent?: CustomElementRegistryLike;

  constructor(parent?: CustomElementRegistryLike) {
    this._parent = parent;
  }

  define(name: string, ctor: new () => any): void {
    const lower = name.toLowerCase();
    if (this._definitions.has(lower)) {
      throw new Error(`Custom element '${name}' is already defined`);
    }
    (ctor as any).is = lower;
    this._definitions.set(lower, ctor);
  }

  get(name: string): (new () => any) | undefined {
    const lower = name.toLowerCase();
    return this._definitions.get(lower) ?? this._parent?.get(lower);
  }

  has(name: string): boolean {
    const lower = name.toLowerCase();
    return this._definitions.has(lower) || (this._parent ? Boolean(this._parent.get(lower)) : false);
  }

  getRegisteredTagNames(): string[] {
    const names = new Set<string>(this._definitions.keys());
    if (typeof this._parent?.getRegisteredTagNames === 'function') {
      for (const name of this._parent.getRegisteredTagNames()) {
        names.add(name.toLowerCase());
      }
    }
    return Array.from(names);
  }
}
