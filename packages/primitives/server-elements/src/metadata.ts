/** Compiler-emitted metadata for one `@action()` method, keyed by action hash on `__lit_actions`. */
export interface ActionMeta {
  name: string;
  /** Properties the action statically writes. */
  writes?: string[];
  /** `false` skips loader revalidation after the action. */
  revalidate?: boolean;
  /** Compiler-synthesized argument validator; throws on invalid input. */
  validate?: (args: unknown[]) => unknown[];
}

/** Compiler-emitted metadata for one `@loader()` method, keyed by method name on `__lit_loaders`. */
export interface LoaderMeta {
  /** Properties this loader assigns. */
  writes?: string[];
  /** Re-run after an action only when the action wrote one of these. Omitted: re-run after every action. */
  dependencies?: string[];
}

/** A custom element class carrying the metadata `@lit-core/server-split` compiles onto it. */
export type ServerElementClass = (new (
  ...args: any[]
) => any) & {
  __lit_actions?: Record<string, ActionMeta>;
  __lit_loaders?: Record<string, LoaderMeta>;
  __litBuildId?: string;
  __litPartDeps?: Record<number, string[]> | string[][];
};

/** The loader metadata the execution layer reads from a class. */
export type LoaderHost = Pick<ServerElementClass, '__lit_loaders'>;

/** An element instance as the execution layer sees it: members are looked up by compiled method name. */
export interface ServerElementInstance {
  _setContext?(context: unknown): void;
  [member: PropertyKey]: unknown;
}

/** Resolves a tag name to its server element class: `customElements`, or a build-time manifest. */
export interface ServerElementRegistry {
  get(tagName: string): ServerElementClass | undefined;
}

/** True for classes the compiler (or a `load()` convention) marks as having server-side behavior. */
export function isServerElementClass(Ctor: unknown): Ctor is ServerElementClass {
  if (!Ctor) return false;
  const ctor = Ctor as ServerElementClass;
  return Boolean(ctor.__lit_loaders || ctor.__lit_actions || typeof ctor.prototype?.load === 'function');
}
