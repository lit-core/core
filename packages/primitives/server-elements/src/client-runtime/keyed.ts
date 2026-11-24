import type { KeyedItem, KeyedOp } from '../types.js';
import type { PartRegion } from './container.js';
import { clearBetween, documentOf, parseFragment } from './dom.js';

export type KeyedNodeCache = Map<string | number, Node>;

/** Builds the DOM node for one keyed item and tags it so it can be found again. */
function createItemNode(doc: Document, item: KeyedItem): Node | null {
  if (!isRecord(item)) return null;
  let node: Node | null;
  if (typeof item.html === 'string') {
    const fragment = parseFragment(doc, item.html);
    node = fragment.firstElementChild ?? fragment.firstChild;
  } else {
    node = doc.createElement('span');
    node.textContent = item.text ?? '';
  }
  (node as Element | null)?.setAttribute?.('data-lit-key', String(item.key));
  return node;
}

/** A frame crosses the network, so each op is checked for the shape it needs before it touches the DOM. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function removeNode(node: Node | undefined): void {
  node?.parentNode?.removeChild(node);
}

/**
 * Applies keyed list operations to a region, keeping `cache` (key to live node) in step so
 * unchanged items keep their DOM identity, focus and internal state across patches.
 */
export function applyKeyedOps(region: PartRegion, cache: KeyedNodeCache, ops: readonly KeyedOp[]): void {
  const { parent, start, end } = region;
  const doc = documentOf(parent);

  for (const op of ops) {
    if (!isRecord(op)) continue;
    switch (op.op) {
      case 'replace': {
        if (!Array.isArray(op.items)) break;
        clearBetween(start, end, parent);
        cache.clear();
        for (const item of op.items) {
          const node = createItemNode(doc, item);
          if (node) {
            parent.insertBefore(node, end);
            cache.set(item.key, node);
          }
        }
        break;
      }
      case 'remove': {
        removeNode(cache.get(op.key));
        cache.delete(op.key);
        break;
      }
      case 'insert': {
        const node = createItemNode(doc, op);
        if (node) {
          parent.insertBefore(node, end);
          cache.set(op.key, node);
        }
        break;
      }
      case 'update': {
        const previous = cache.get(op.key);
        const node = createItemNode(doc, op);
        if (node) {
          parent.insertBefore(node, previous?.parentNode === parent ? previous : end);
          removeNode(previous);
          cache.set(op.key, node);
        }
        break;
      }
      case 'reorder': {
        if (!Array.isArray(op.order)) break;
        let before: Node | null = start;
        for (const key of op.order) {
          const node = cache.get(key);
          if (!node) continue;
          const expected: Node | null = before ? before.nextSibling : parent.firstChild;
          if (node !== expected) {
            parent.insertBefore(node, expected);
          }
          before = node;
        }
        break;
      }
    }
  }
}
