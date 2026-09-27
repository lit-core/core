export declare function resolveNodeByPath(root: Node, path: number[]): Node;
export declare function resolveNodesByPaths(root: Node, paths: number[][]): Node[];
export declare function preparePartsWithPaths<T = Node>(
  root: Node,
  paths: number[][],
  callback?: (node: Node, index: number) => T
): T[];
