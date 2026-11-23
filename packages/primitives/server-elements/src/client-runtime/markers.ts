import { COMMENT_NODE, documentOf, PROCESSING_INSTRUCTION_NODE, SHOW_MARKER_NODES } from './dom.js';

/**
 * Range markers are emitted by the server as `<?start name="pN">` and `<?end>`. HTML parsers
 * surface them as comments whose data is `?start name="pN"` and `?end`; XML parsers surface
 * them as processing instructions with target `start` / `end`.
 */
export function isStartMarker(node: Node | null | undefined): boolean {
  if (!node) return false;
  if (node.nodeType === PROCESSING_INSTRUCTION_NODE) {
    return (node as ProcessingInstruction).target === 'start';
  }
  return node.nodeType === COMMENT_NODE && (node as Comment).data.startsWith('?start');
}

export function isEndMarker(node: Node | null | undefined): boolean {
  if (!node) return false;
  if (node.nodeType === PROCESSING_INSTRUCTION_NODE) {
    return (node as ProcessingInstruction).target === 'end';
  }
  return node.nodeType === COMMENT_NODE && (node as Comment).data === '?end';
}

/** Returns the node after the end marker that closes the range opened by `start`, honoring nesting. */
function findMatchingEnd(start: Node): Node | null {
  let depth = 0;
  for (let cursor = start.nextSibling; cursor; cursor = cursor.nextSibling) {
    if (isStartMarker(cursor)) {
      depth++;
    } else if (isEndMarker(cursor)) {
      if (depth === 0) return cursor;
      depth--;
    }
  }
  return null;
}

/**
 * Steps to the Nth logical child of `parent`, treating each `<?start>...<?end>` range
 * (and everything inside it) as a single logical child.
 */
export function getLogicalChild(parent: Node | null | undefined, logicalIndex: number): Node | null {
  const nodes = parent?.childNodes;
  if (!nodes) return null;

  let logical = 0;
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    if (logical === logicalIndex) {
      return node;
    }
    if (isStartMarker(node)) {
      const end = findMatchingEnd(node);
      if (end) {
        while (i < nodes.length && nodes[i] !== end) i++;
      }
    }
    logical++;
  }
  return null;
}

/** Resolves a node from a root via a numeric logical-child index path. */
export function resolveNodeByPath(root: Node, path: readonly number[]): Node | null {
  let cursor: Node | null = root;
  for (const index of path) {
    cursor = getLogicalChild(cursor, index);
    if (!cursor) return null;
  }
  return cursor;
}

function isNamedStart(node: Node | null, name: string): node is Node {
  if (!node || !isStartMarker(node)) return false;
  const data = node.nodeType === PROCESSING_INSTRUCTION_NODE ? (node as ProcessingInstruction).data : (node as Comment).data;
  return data.includes(`name="${name}"`);
}

/**
 * Locates the start and end markers of the range-addressed part `name`. The compiled `startPath`
 * is tried first; a tree walk is the fallback when markers moved relative to the compiled path
 * (for example after adopted styles were lifted out of the shadow root).
 */
export function resolveRangeMarkers(root: Node, name: string, startPath?: readonly number[]): { start: Node; end: Node } | null {
  let start: Node | null = null;

  if (startPath && startPath.length > 0) {
    const candidate = resolveNodeByPath(root, startPath);
    if (isNamedStart(candidate, name)) start = candidate;
  }

  if (!start) {
    const walker = documentOf(root).createTreeWalker?.(root, SHOW_MARKER_NODES);
    while (walker?.nextNode()) {
      if (isNamedStart(walker.currentNode, name)) {
        start = walker.currentNode;
        break;
      }
    }
  }

  const end = start ? findMatchingEnd(start) : null;
  return start && end ? { start, end } : null;
}
