/**
 * Ahead-of-time structural DOM path resolver helper.
 * Traverses native C++ .childNodes pointers in nanoseconds, eliminating
 * runtime TreeWalker comment-node and element discovery during component mount.
 *
 * @param root The root container node (ShadowRoot, DocumentFragment, or Element)
 * @param path Array of child indices from root to the target node
 * @returns The resolved DOM Node
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
 * @param root The root container node
 * @param paths Array of child index paths
 * @returns Array of resolved DOM Nodes
 */
export function resolveNodesByPaths(root, paths) {
  const ctor = root.host?.constructor ?? root.constructor;
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
export function preparePartsWithPaths(root, paths, callback) {
  const ctor = root.host?.constructor ?? root.constructor;
  if (typeof ctor?.__litPartNodes === 'function') {
    const nodes = ctor.__litPartNodes(root);
    if (!callback) return nodes;
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
    parts[i] = callback ? callback(node, i) : node;
  }
  return parts;
}
