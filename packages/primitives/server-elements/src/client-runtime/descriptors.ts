/**
 * Part descriptors as compiled onto `static __litParts` by `@lit-core/server-split`.
 * Each descriptor tells the client where one dynamic binding lives in the shadow root.
 */
export interface ElementPartDescriptor {
  kind: 'element';
  /** Logical child-index path from the shadow root to the element. */
  path: number[];
  /** Attribute or property name. */
  attr: string;
  /** `'.'` property, `'?'` boolean attribute, `''` plain attribute. */
  prefix?: string;
  targetTag?: string;
}

export interface SoleTextPartDescriptor {
  kind: 'sole-text';
  /** Path to the element whose only child is this binding. */
  path: number[];
  targetTag?: string;
}

export interface RangePartDescriptor {
  kind: 'range';
  /** Marker name, as in `<?start name="p0">`. */
  name: string;
  startPath?: number[];
  parentPath?: number[];
}

export type ClientPartDescriptor = ElementPartDescriptor | SoleTextPartDescriptor | RangePartDescriptor;

/** Reads the compiled part table from an element's constructor. */
export function readPartTable(element: object): readonly ClientPartDescriptor[] {
  const table = (element.constructor as { __litParts?: unknown }).__litParts;
  return Array.isArray(table) ? (table as ClientPartDescriptor[]) : [];
}
