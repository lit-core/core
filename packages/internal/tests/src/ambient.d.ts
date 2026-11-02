declare module '@lit-core/ssr/slot' {
  export interface SlottedNode {
    slotName: string;
    content?: unknown;
    opcodes?: any[];
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
    constructor(hostTagName: string, parentContext?: SlotProjectionContext | null);
    addNode(node: SlottedNode): void;
    getAssignedNodes(slotName?: string): SlottedNode[];
    hasAssignedNodes(slotName?: string): boolean;
  }
  export class SlotManager {
    pushContext(hostTagName: string): SlotProjectionContext;
    popContext(): SlotProjectionContext | null;
    get currentContext(): SlotProjectionContext | null;
    get depth(): number;
  }
  export function findMatchingCloseTag(opcodes: any[], openIndex: number, maxEnd?: number): number;
  export function distributeHostChildren(opcodes: any[], values: unknown[], start: number, end: number, context: SlotProjectionContext): void;
}
