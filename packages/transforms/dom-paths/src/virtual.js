/**
 * Self-contained in-memory source for virtual:lit-core/dom-paths.
 * Resolves DOM parts via native .childNodes indexing, bypassing TreeWalker scanning.
 */
export const DOM_PATHS_SOURCE = `
export function resolveNodeByPath(root, path) {
  let cur = root;
  for (let i = 0; i < path.length; i++) {
    cur = cur.childNodes[path[i]];
  }
  return cur;
}

export function resolveNodesByPaths(root, paths) {
  const ctor = (root.host?.constructor ?? root.constructor);
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

export function preparePartsWithPaths(root, paths, callback) {
  const ctor = (root.host?.constructor ?? root.constructor);
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
`;
