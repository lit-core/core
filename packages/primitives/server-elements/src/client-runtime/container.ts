import type { ClientPartDescriptor } from './descriptors.js';
import { resolveNodeByPath, resolveRangeMarkers } from './markers.js';

/**
 * The DOM region a multi-node binding owns: the children of `parent` between `start` and `end`.
 * A sole-text container owns all children of its element, so both anchors are `null`.
 */
export interface PartRegion {
  parent: Node;
  start: Node | null;
  end: Node | null;
}

/** Resolves the region a structural or keyed binding owns, or `null` when the DOM no longer matches the descriptor. */
export function resolvePartRegion(root: Node, descriptor: ClientPartDescriptor | undefined): PartRegion | null {
  if (descriptor?.kind === 'range') {
    const markers = resolveRangeMarkers(root, descriptor.name, descriptor.startPath);
    return markers?.end.parentNode ? { parent: markers.end.parentNode, start: markers.start, end: markers.end } : null;
  }
  if (descriptor?.kind === 'sole-text') {
    const target = resolveNodeByPath(root, descriptor.path);
    return target?.nodeType === 1 ? { parent: target, start: null, end: null } : null;
  }
  return null;
}
