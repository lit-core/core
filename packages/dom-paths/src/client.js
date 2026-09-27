/**
 * Ahead-of-time structural DOM path resolver helper.
 * Traverses native C++ .childNodes pointers in nanoseconds, eliminating
 * runtime TreeWalker comment-node and element discovery during component mount.
 *
 * @param {Node} root The root container node (ShadowRoot, DocumentFragment, or Element)
 * @param {number[]} path Array of child indices from root to the target node
 * @returns {Node} The resolved DOM Node
 */
export function resolveNodeByPath(root, path) {
  let cur = root;
  for (let i = 0; i < path.length; i++) {
    cur = cur.childNodes[path[i]];
  }
  return cur;
}

/**
 * Resolves multiple target nodes from an array of precomputed structural paths.
 *
 * @param {Node} root The root container node
 * @param {number[][]} paths Array of child index paths
 * @returns {Node[]} Array of resolved DOM Nodes
 */
export function resolveNodesByPaths(root, paths) {
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
 * @template T
 * @param {Node} root The root container node (e.g. this.shadowRoot)
 * @param {number[][]} paths Precomputed static __litPartPaths
 * @param {(node: Node, index: number) => T} [callback] Callback invoked for each resolved part node
 * @returns {T[]}
 */
export function preparePartsWithPaths(root, paths, callback) {
  const len = paths.length;
  const parts = new Array(len);
  for (let i = 0; i < len; i++) {
    const node = resolveNodeByPath(root, paths[i]);
    parts[i] = callback ? callback(node, i) : node;
  }
  return parts;
}
