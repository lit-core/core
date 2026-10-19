/**
 * Ahead-of-time structural DOM path resolver helper.
 * Traverses native C++ .childNodes pointers in nanoseconds, eliminating
 * runtime TreeWalker comment-node and element discovery during component mount.
 *
 * @param root The root container node (ShadowRoot, DocumentFragment, or Element)
 * @param path Array of child indices from root to the target node
 * @returns The resolved DOM Node
 */
export function resolveNodeByPath(root: Node, path: number[]): Node {
  let cur: any = root;
  for (let i = 0; i < path.length; i++) {
    cur = cur.childNodes[path[i]];
  }
  return cur;
}

/**
 * Resolves multiple target nodes from an array of precomputed structural paths.
 *
 * @param root The root container node
 * @param paths Array of child index paths
 * @returns Array of resolved DOM Nodes
 */
export function resolveNodesByPaths(root: Node, paths: number[][]): Node[] {
  const ctor = ((root as ShadowRoot).host?.constructor ?? root.constructor) as any;
  if (typeof ctor?.__litPartNodes === 'function') {
    return ctor.__litPartNodes(root);
  }
  const len = paths.length;
  const nodes = new Array(len);
  for (let i = 0; i < len; i++) {
    nodes[i] = resolveNodeByPath(root, paths[i]);
  }
  return nodes;
}

/**
 * Prepares component parts directly via precomputed structural paths,
 * bypassing document.createTreeWalker.
 *
 * @param root The root container node (e.g. this.shadowRoot)
 * @param paths Precomputed static __litPartPaths
 * @param callback Callback invoked for each resolved part node
 */
export function preparePartsWithPaths<T = Node>(root: Node, paths: number[][], callback?: (node: Node, index: number) => T): T[] {
  const ctor = ((root as ShadowRoot).host?.constructor ?? root.constructor) as any;
  if (typeof ctor?.__litPartNodes === 'function') {
    const nodes: Node[] = ctor.__litPartNodes(root);
    if (!callback) return nodes as unknown as T[];
    const len = nodes.length;
    const parts = new Array(len);
    for (let i = 0; i < len; i++) {
      parts[i] = callback(nodes[i], i);
    }
    return parts;
  }
  const len = paths.length;
  const parts = new Array(len);
  for (let i = 0; i < len; i++) {
    const node = resolveNodeByPath(root, paths[i]);
    parts[i] = callback ? callback(node, i) : (node as unknown as T);
  }
  return parts;
}
