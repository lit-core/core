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

export declare function computeDomPaths(
  templateStrings: string[] | TemplateStringsArray,
  options?: DomPathsOptions
): number[][];

export declare function transformDomPaths(
  source: string,
  options?: DomPathsOptions
): DomPathsResult;

export declare const DOM_PATHS_SOURCE: string;

export declare function resolveNodeByPath(root: Node, path: number[]): Node;

export declare function resolveNodesByPaths(root: Node, paths: number[][]): Node[];

export declare function preparePartsWithPaths<T = Node>(
  root: Node,
  paths: number[][],
  callback?: (node: Node, index: number) => T
): T[];

export default transformDomPaths;
