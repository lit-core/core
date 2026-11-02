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

export function resolveSoleTextParent(root, parentPath) {
  return resolveNodeByPath(root, parentPath);
}

export function resolveRangeMarkers(root, markerName, startPath) {
  let start = null;
  if (startPath && startPath.length > 0) {
    const candidate = resolveNodeByPath(root, startPath);
    if (
      candidate &&
      candidate.nodeType === 8 &&
      (candidate.data.startsWith('?start name="' + markerName + '"') ||
        candidate.data.startsWith('start name="' + markerName + '"'))
    ) {
      start = candidate;
    }
  }
  if (!start) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_COMMENT);
    const p1 = '?start name="' + markerName + '"';
    const p2 = 'start name="' + markerName + '"';
    while (walker.nextNode()) {
      const c = walker.currentNode;
      if (c.data.startsWith(p1) || c.data.startsWith(p2)) {
        start = c;
        break;
      }
    }
  }
  if (!start) {
    throw new Error("Range start marker '" + markerName + "' not found");
  }

  let end = null;
  let depth = 0;
  let cur = start.nextSibling;
  while (cur) {
    if (cur.nodeType === 8) {
      const d = cur.data;
      if (d.startsWith('?start') || d.startsWith('start name=')) {
        depth++;
      } else if (d === '?end' || d.startsWith('?end') || d === 'end' || d.startsWith('end')) {
        if (depth === 0) {
          end = cur;
          break;
        }
        depth--;
      }
    }
    cur = cur.nextSibling;
  }
  if (!end) {
    throw new Error("Range end marker for '" + markerName + "' not found");
  }
  return { start, end };
}
`;
