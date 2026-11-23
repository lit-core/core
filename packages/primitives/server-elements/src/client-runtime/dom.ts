export const ELEMENT_NODE = 1;
export const TEXT_NODE = 3;
export const PROCESSING_INSTRUCTION_NODE = 7;
export const COMMENT_NODE = 8;

/** `NodeFilter.SHOW_COMMENT | NodeFilter.SHOW_PROCESSING_INSTRUCTION`, spelled out so no DOM global is needed. */
export const SHOW_MARKER_NODES = 128 | 64;

/** The document that owns a node, falling back to the global document. */
export function documentOf(node: Node): Document {
  return node.ownerDocument ?? ((globalThis as { document?: Document }).document as Document);
}

/** Parses trusted server markup into a fragment. */
export function parseFragment(doc: Document, html: string): DocumentFragment {
  const template = doc.createElement('template');
  template.innerHTML = html;
  return template.content;
}

/** Removes every sibling strictly between `start` and `end`. */
export function clearBetween(start: Node | null, end: Node | null, parent: Node): void {
  let cursor = start ? start.nextSibling : parent.firstChild;
  while (cursor && cursor !== end) {
    const next = cursor.nextSibling;
    cursor.parentNode?.removeChild(cursor);
    cursor = next;
  }
}
