import type { KeyedListPatchFrame, PatchFrame, ScalarPatchFrame, StateSnapshotPatchFrame, StructuralPatchFrame, WireState } from '../types.js';
import { resolvePartRegion } from './container.js';
import { type ClientPartDescriptor, readPartTable } from './descriptors.js';
import { clearBetween, documentOf, parseFragment } from './dom.js';
import { applyKeyedOps, type KeyedNodeCache } from './keyed.js';
import { applyScalarPart } from './scalar.js';
import { adoptLeadingSsrStyles } from './styles.js';

/** Client-side state the patch executor keeps on each host element. */
interface PatchableElement extends HTMLElement {
  __litState?: WireState;
  __litSig?: string;
  __litSnapshotSeq?: number;
  __litKeyCaches?: Map<number, KeyedNodeCache>;
}

function applyStateFrame(element: PatchableElement, frame: StateSnapshotPatchFrame): void {
  element.__litState = frame.s;
  element.setAttribute?.('data-lit-state', typeof frame.s === 'string' ? frame.s : JSON.stringify(frame.s));
  if (frame.sig) {
    element.__litSig = frame.sig;
    if (typeof frame.sq === 'number') {
      element.__litSnapshotSeq = frame.sq;
    }
    element.setAttribute?.('data-lit-sig', frame.sig);
  }
}

function applyStructuralFrame(root: Node, descriptor: ClientPartDescriptor | undefined, frame: StructuralPatchFrame): void {
  const html = frame.f?.html;
  const region = resolvePartRegion(root, descriptor);
  if (typeof html !== 'string' || !html || !region) return;

  clearBetween(region.start, region.end, region.parent);
  region.parent.insertBefore(parseFragment(documentOf(root), html), region.end);
}

function applyKeyedFrame(element: PatchableElement, root: Node, descriptor: ClientPartDescriptor | undefined, frame: KeyedListPatchFrame): void {
  const region = resolvePartRegion(root, descriptor);
  const ops = frame.k?.ops;
  if (!region || !Array.isArray(ops)) return;

  const caches = (element.__litKeyCaches ??= new Map());
  let cache = caches.get(frame.p);
  if (!cache) {
    cache = new Map();
    caches.set(frame.p, cache);
  }
  applyKeyedOps(region, cache, ops);
}

/**
 * Applies action response frames to an element's shadow root.
 *
 * Frames address parts by index into the element's compiled part table. A frame whose part cannot
 * be found in the live DOM is skipped rather than guessed at: guessing patches the wrong node.
 */
export function executePatches(element: HTMLElement, frames: PatchFrame | PatchFrame[]): void {
  if (!element) return;
  const host = element as PatchableElement;
  const root: Node = host.shadowRoot || host;
  adoptLeadingSsrStyles(host, root as ShadowRoot);
  const parts = readPartTable(host);

  for (const frame of Array.isArray(frames) ? frames : [frames]) {
    if (!frame || typeof frame !== 'object') continue;

    if ('s' in frame && frame.s) {
      applyStateFrame(host, frame as StateSnapshotPatchFrame);
      continue;
    }
    if (!('p' in frame) || typeof frame.p !== 'number') continue;

    const descriptor = parts[frame.p];
    if ('f' in frame) {
      applyStructuralFrame(root, descriptor, frame);
    } else if ('k' in frame) {
      applyKeyedFrame(host, root, descriptor, frame);
    } else if ('v' in frame) {
      applyScalarPart(root, descriptor, (frame as ScalarPatchFrame).v);
    }
  }
}

// Registers the executor for compiler-injected stubs when running in a browser window.
if (typeof window !== 'undefined') {
  (window as unknown as { __litExecutePatches?: typeof executePatches }).__litExecutePatches = executePatches;
}
