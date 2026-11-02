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
/**
 * Resolves the parent element for a sole text child part, enabling fast O(1)
 * direct updates via parentEl.textContent = val without indexing child nodes.
 *
 * @param root The root container node (ShadowRoot or Element)
 * @param parentPath Structural child index path to the parent element
 * @returns The resolved parent Element
 */
export function resolveSoleTextParent(root, parentPath) {
  return resolveNodeByPath(root, parentPath);
}
/**
 * Resolves the start and end markers (<?start name="pN"> and <?end>)
 * for a range-addressed dynamic expression, supporting both ProcessingInstruction
 * nodes (WHATWG HTML5 / WICG type 7) and Comment nodes (type 8).
 *
 * @param root The root container node (ShadowRoot or Element)
 * @param markerName Name of the part (e.g. "p0")
 * @param startPath Optional direct structural path to the start marker
 * @returns Object containing the start and end marker Nodes
 */
export function resolveRangeMarkers(root, markerName, startPath) {
  let start = null;
  const targetData = `name="${markerName}"`;
  if (startPath && startPath.length > 0) {
    const candidate = resolveNodeByPath(root, startPath);
    if (candidate) {
      if (candidate.nodeType === 7 && candidate.target === 'start' && candidate.data.includes(targetData)) {
        start = candidate;
      } else if (candidate.nodeType === 8 && (candidate.data.startsWith(`?start name="${markerName}"`) || candidate.data.startsWith(`start name="${markerName}"`))) {
        start = candidate;
      }
    }
  }
  if (!start) {
    const whatToShow = NodeFilter.SHOW_COMMENT | (NodeFilter.SHOW_PROCESSING_INSTRUCTION ?? 64);
    const walker = document.createTreeWalker(root, whatToShow);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (node.nodeType === 7) {
        const pi = node;
        if (pi.target === 'start' && pi.data.includes(targetData)) {
          start = node;
          break;
        }
      } else if (node.nodeType === 8) {
        const comment = node;
        if (comment.data.startsWith(`?start name="${markerName}"`) || comment.data.startsWith(`start name="${markerName}"`)) {
          start = node;
          break;
        }
      }
    }
  }
  if (!start) {
    throw new Error(`Range start marker '${markerName}' not found`);
  }
  let end = null;
  let depth = 0;
  let cur = start.nextSibling;
  while (cur) {
    if (cur.nodeType === 7) {
      const pi = cur;
      if (pi.target === 'start') {
        depth++;
      } else if (pi.target === 'end') {
        if (depth === 0) {
          end = cur;
          break;
        }
        depth--;
      }
    } else if (cur.nodeType === 8) {
      const data = cur.data;
      if (data.startsWith('?start') || data.startsWith('start name=')) {
        depth++;
      } else if (data === '?end' || data.startsWith('?end') || data === 'end' || data.startsWith('end')) {
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
    throw new Error(`Range end marker for '${markerName}' not found`);
  }
  return { start, end };
}
