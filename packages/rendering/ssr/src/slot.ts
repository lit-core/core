/**
 * Opcode-driven server-side slot projection engine for @lit-core/ssr.
 * Resolves default slots, named slots, and fallback content across nested custom element boundaries
 * operating strictly over AST opcode ranges without regex or character-scanning loops.
 */

import type { SsrOpcode } from './compiler-bridge.js';

export interface SlottedNode {
  slotName: string; // "" for default slot, otherwise slot attribute value
  content?: unknown;
  opcodes?: SsrOpcode[];
  values?: unknown[];
  startIndex?: number;
  endIndex?: number;
}

export type SlottedOpcodeNode = SlottedNode;

export interface SlotDistribution {
  defaultSlot: SlottedNode[];
  namedSlots: Map<string, SlottedNode[]>;
}

export class SlotProjectionContext {
  readonly hostTagName: string;
  readonly parentContext: SlotProjectionContext | null;
  readonly distribution: SlotDistribution;

  constructor(hostTagName: string, parentContext: SlotProjectionContext | null = null) {
    this.hostTagName = hostTagName;
    this.parentContext = parentContext;
    this.distribution = {
      defaultSlot: [],
      namedSlots: new Map(),
    };
  }

  addNode(node: SlottedNode): void {
    const slotName = (node.slotName || '').trim();
    if (!slotName) {
      this.distribution.defaultSlot.push(node);
    } else {
      let list = this.distribution.namedSlots.get(slotName);
      if (!list) {
        list = [];
        this.distribution.namedSlots.set(slotName, list);
      }
      list.push(node);
    }
  }

  getAssignedNodes(slotName: string = ''): SlottedNode[] {
    const name = (slotName || '').trim();
    if (!name) {
      return this.distribution.defaultSlot;
    }
    return this.distribution.namedSlots.get(name) ?? [];
  }

  hasAssignedNodes(slotName: string = ''): boolean {
    return this.getAssignedNodes(slotName).length > 0;
  }
}

export class SlotManager {
  private _contextStack: SlotProjectionContext[] = [];

  pushContext(hostTagName: string): SlotProjectionContext {
    const parent = this._contextStack.at(-1) ?? null;
    const ctx = new SlotProjectionContext(hostTagName, parent);
    this._contextStack.push(ctx);
    return ctx;
  }

  popContext(): SlotProjectionContext | null {
    return this._contextStack.pop() ?? null;
  }

  get currentContext(): SlotProjectionContext | null {
    return this._contextStack.at(-1) ?? null;
  }

  get depth(): number {
    return this._contextStack.length;
  }
}

/**
 * Find the index of the matching close opcode for an open tag,
 * preferring closeIndex if valid, or scanning AST opcodes by tag depth.
 */
export function findMatchingCloseTag(opcodes: SsrOpcode[], openIndex: number, maxEnd: number = opcodes.length): number {
  const openOp = opcodes[openIndex];
  if (openOp.type !== 'open' || openOp.isVoid || openOp.isSelfClosing) {
    return openIndex;
  }
  if (openOp.closeIndex !== undefined && openOp.closeIndex < maxEnd && openOp.closeIndex > openIndex) {
    const candidate = opcodes[openOp.closeIndex];
    if (candidate.type === 'close' && candidate.tag === openOp.tag) {
      return openOp.closeIndex;
    }
  }
  let depth = 1;
  for (let j = openIndex + 1; j < maxEnd; j++) {
    const cur = opcodes[j];
    if (cur.type === 'open' && cur.tag === openOp.tag && !cur.isVoid && !cur.isSelfClosing) {
      depth++;
    } else if (cur.type === 'close' && cur.tag === openOp.tag) {
      depth--;
      if (depth === 0) {
        return j;
      }
    }
  }
  return openIndex;
}

/**
 * Partition and distribute the host custom element's child opcodes
 * from start to end into the slot projection context based on their static
 * or dynamic slot attribute values.
 */
export function distributeHostChildren(opcodes: SsrOpcode[], values: unknown[], start: number, end: number, context: SlotProjectionContext): void {
  let k = start;
  while (k < end) {
    const op = opcodes[k];
    switch (op.type) {
      case 'open': {
        let slotName = '';
        if (op.staticAttrs && 'slot' in op.staticAttrs) {
          slotName = (op.staticAttrs.slot || '').trim();
        } else if (op.dynamicAttrs) {
          const dynSlot = op.dynamicAttrs.find((d) => d.type === 'attribute' && d.name === 'slot');
          if (dynSlot) {
            const raw = dynSlot.index < values.length ? values[dynSlot.index] : undefined;
            if (raw !== null && raw !== undefined) {
              slotName = String(raw).trim();
            }
          }
        }

        const closeIdx = findMatchingCloseTag(opcodes, k, end);
        const childEnd = op.isVoid ? k + 1 : closeIdx > k ? closeIdx + 1 : k + 1;

        context.addNode({
          slotName,
          opcodes,
          values,
          startIndex: k,
          endIndex: childEnd,
        });

        k = childEnd;
        break;
      }
      case 'text': {
        if (op.value.trim().length > 0) {
          context.addNode({
            slotName: '',
            opcodes,
            values,
            startIndex: k,
            endIndex: k + 1,
          });
        }
        k++;
        break;
      }
      case 'part': {
        context.addNode({
          slotName: '',
          opcodes,
          values,
          startIndex: k,
          endIndex: k + 1,
        });
        k++;
        break;
      }
      case 'marker-start': {
        let markerEnd = k + 1;
        let depth = 1;
        while (markerEnd < end && depth > 0) {
          if (opcodes[markerEnd].type === 'marker-start') {
            depth++;
          } else if (opcodes[markerEnd].type === 'marker-end') {
            depth--;
          }
          markerEnd++;
        }
        context.addNode({
          slotName: '',
          opcodes,
          values,
          startIndex: k,
          endIndex: markerEnd,
        });
        k = markerEnd;
        break;
      }
      default: {
        k++;
        break;
      }
    }
  }
}
