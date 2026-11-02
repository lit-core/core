export interface DomPathsOptions {
  sourcemap?: boolean;
  filename?: string;
  normalizeWhitespace?: boolean;
}

export interface DomPathsResult {
  code: string;
  map?: string | null;
  componentsCount: number;
  pathsCount: number;
  paths: number[][][];
}

export interface PartAddressing {
  type: 'ElementAnchored' | 'SoleTextChild' | 'RangeAddressed' | string;
  kind: 'element' | 'sole-text' | 'range' | string;
  path?: number[];
  targetTag?: string;
  attrName?: string;
  prefix?: string;
  indices?: number[];
  strings?: string[];
  parentPath?: number[];
  parentTag?: string;
  name?: string;
  startPath?: number[];
}

export interface PartDescriptor {
  path: number[];
  isAttribute: boolean;
  targetTag?: string;
  addressing: PartAddressing;
}

export declare function computeDomPaths(
  templateStrings: string[] | TemplateStringsArray,
  options?: DomPathsOptions,
): number[][];

export declare function computeDomParts(
  templateStrings: string[] | TemplateStringsArray,
  options?: DomPathsOptions,
): PartDescriptor[];

export declare function transformDomPaths(
  source: string,
  options?: DomPathsOptions,
): DomPathsResult;

export declare const DOM_PATHS_SOURCE: string;

export declare function resolveNodeByPath(root: Node, path: number[]): Node;

export declare function resolveNodesByPaths(root: Node, paths: number[][]): Node[];

export declare function preparePartsWithPaths<T = Node>(
  root: Node,
  paths: number[][],
  callback?: (node: Node, index: number) => T,
): T[];

export declare function resolveSoleTextParent(root: Node, parentPath: number[]): Element;

export declare function resolveRangeMarkers(
  root: Node,
  markerName: string,
  startPath?: number[],
): { start: Comment; end: Comment };

export default transformDomPaths;
