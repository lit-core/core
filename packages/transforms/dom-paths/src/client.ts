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

/**
 * Resolves the parent element for a sole text child part, enabling fast O(1)
 * direct updates via parentEl.textContent = val without indexing child nodes.
 *
 * @param root The root container node (ShadowRoot or Element)
 * @param parentPath Structural child index path to the parent element
 * @returns The resolved parent Element
 */
export function resolveSoleTextParent(root: Node, parentPath: number[]): Element {
  return resolveNodeByPath(root, parentPath) as Element;
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
export function resolveRangeMarkers(root: Node, markerName: string, startPath?: number[]): { start: Node; end: Node } {
  let start: Node | null = null;
  const targetData = `name="${markerName}"`;

  if (startPath && startPath.length > 0) {
    const candidate = resolveNodeByPath(root, startPath);
    if (candidate) {
      if (candidate.nodeType === 7 && (candidate as ProcessingInstruction).target === 'start' && (candidate as ProcessingInstruction).data.includes(targetData)) {
        start = candidate;
      } else if (candidate.nodeType === 8 && ((candidate as Comment).data.startsWith(`?start name="${markerName}"`) || (candidate as Comment).data.startsWith(`start name="${markerName}"`))) {
        start = candidate;
      }
    }
  }

  if (!start) {
    const whatToShow = (NodeFilter.SHOW_COMMENT as number) | ((NodeFilter as any).SHOW_PROCESSING_INSTRUCTION ?? 64);
    const walker = document.createTreeWalker(root, whatToShow);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (node.nodeType === 7) {
        const pi = node as ProcessingInstruction;
        if (pi.target === 'start' && pi.data.includes(targetData)) {
          start = node;
          break;
        }
      } else if (node.nodeType === 8) {
        const comment = node as Comment;
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

  let end: Node | null = null;
  let depth = 0;
  let cur: Node | null = start.nextSibling;
  while (cur) {
    if (cur.nodeType === 7) {
      const pi = cur as ProcessingInstruction;
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
      const data = (cur as Comment).data;
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
