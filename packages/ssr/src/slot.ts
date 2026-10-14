/**
 * Deterministic server-side slot projection engine for @lit-core/ssr.
 * Resolves default slots, named slots, and fallback content across nested custom element boundaries.
 */

export interface SlottedNode {
  slotName: string; // "" for default slot, otherwise slot attribute value
  content: unknown;
  tagName?: string;
  attributes?: Record<string, string>;
}

export interface SlotDistribution {
  defaultSlot: SlottedNode[];
  namedSlots: Map<string, SlottedNode[]>;
}

export class SlotProjectionContext {
  readonly hostTagName: string;
  readonly distribution: SlotDistribution;
  readonly parentContext: SlotProjectionContext | null;

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
    const name = slotName.trim();
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
 * Parse an HTML tag's attribute string into a key-value Map.
 */
export function parseAttributes(attrString: string): Map<string, string> {
  const attrs = new Map<string, string>();
  const attrRegex = /([\w\-.:?@]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  let match = attrRegex.exec(attrString);
  while (match !== null) {
    attrs.set(match[1].toLowerCase(), match[2] ?? match[3] ?? match[4] ?? '');
    match = attrRegex.exec(attrString);
  }
  return attrs;
}

/**
 * Extract the name attribute value from a slot tag's attributes.
 */
export function extractNameFromSlotTag(attrString: string): string | null {
  const attrs = parseAttributes(attrString);
  return attrs.get('name') ?? null;
}

/**
 * Extract slot attribute value from an HTML tag string (e.g. `<span slot="header">`).
 */
export function extractSlotNameFromTag(tagString: string): string | null {
  const attrs = parseAttributes(tagString);
  return attrs.get('slot') ?? null;
}

/**
 * Escape unclosed </template> tags in projected content or shadow HTML to prevent
 * premature termination of Declarative Shadow DOM.
 * Legitimate balanced nested <template>...</template> pairs are preserved.
 */
export function escapeUnclosedTemplateTags(html: string): string {
  if (!html || !/<\/template(?=[\s>/])/i.test(html)) {
    return html;
  }

  const tagRegex = /<(\/)?template(?=[\s>/])((?:[^>"']|"[^"]*"|'[^']*')*)>/gi;
  let depth = 0;
  let result = '';
  let lastIndex = 0;
  let match = tagRegex.exec(html);

  while (match !== null) {
    const isClosing = Boolean(match[1]);
    const attrs = match[2] ?? '';
    const matchIndex = match.index;

    result += html.slice(lastIndex, matchIndex);

    if (isClosing) {
      if (depth > 0) {
        depth--;
        result += match[0];
      } else {
        // Unclosed </template> would break out of Declarative Shadow DOM
        result += '&lt;/template&gt;';
      }
    } else {
      const isSelfClosing = attrs.trim().endsWith('/');
      if (!isSelfClosing) {
        depth++;
      }
      result += match[0];
    }

    lastIndex = matchIndex + match[0].length;
    match = tagRegex.exec(html);
  }

  result += html.slice(lastIndex);
  return result;
}

export interface SlotMatch {
  matchIndex: number;
  fullLength: number;
  attrsStr: string;
  fallbackContent: string;
  isSelfClosing: boolean;
}

/**
 * Scan for next <slot> element with depth balancing for nested slot tags.
 */
export function findNextSlot(html: string, startIndex = 0): SlotMatch | null {
  const slotTokenRegex = /<slot\b/gi;
  slotTokenRegex.lastIndex = startIndex;
  const match = slotTokenRegex.exec(html);
  if (!match) return null;

  const pos = match.index;
  const attrStart = pos + 5; // length of '<slot'

  // Scan for closing > of opening tag
  let inQuote: '"' | "'" | null = null;
  let tagEnd = -1;
  let isSelfClosing = false;

  for (let i = attrStart; i < html.length; i++) {
    const ch = html[i];
    if (inQuote) {
      if (ch === inQuote) inQuote = null;
    } else if (ch === '"' || ch === "'") {
      inQuote = ch;
    } else if (ch === '>') {
      tagEnd = i;
      if (i > attrStart && html[i - 1] === '/') {
        isSelfClosing = true;
      }
      break;
    }
  }

  if (tagEnd === -1) return null;

  const attrsStr = isSelfClosing ? html.slice(attrStart, tagEnd - 1) : html.slice(attrStart, tagEnd);

  if (isSelfClosing) {
    return {
      matchIndex: pos,
      fullLength: tagEnd + 1 - pos,
      attrsStr,
      fallbackContent: '',
      isSelfClosing: true,
    };
  }

  // Scan for matching </slot> with depth balancing
  let depth = 1;
  const scanPos = tagEnd + 1;
  const tokenRegex = /<(\/)?slot\b((?:[^>"']|"[^"]*"|'[^']*')*)>/gi;
  tokenRegex.lastIndex = scanPos;

  let tokenMatch = tokenRegex.exec(html);
  let closeTagEnd = -1;
  let closeTagStart = -1;

  while (tokenMatch !== null) {
    const isClose = tokenMatch[1] === '/';
    const isInnerSelfClosing = tokenMatch[2]?.trim().endsWith('/') ?? false;

    if (isClose) {
      depth--;
      if (depth === 0) {
        closeTagStart = tokenMatch.index;
        closeTagEnd = tokenMatch.index + tokenMatch[0].length;
        break;
      }
    } else if (!isInnerSelfClosing) {
      depth++;
    }

    tokenMatch = tokenRegex.exec(html);
  }

  if (closeTagEnd !== -1) {
    return {
      matchIndex: pos,
      fullLength: closeTagEnd - pos,
      attrsStr,
      fallbackContent: html.slice(tagEnd + 1, closeTagStart),
      isSelfClosing: false,
    };
  }

  return {
    matchIndex: pos,
    fullLength: tagEnd + 1 - pos,
    attrsStr,
    fallbackContent: '',
    isSelfClosing: false,
  };
}

/**
 * Deterministically project light DOM nodes into shadow DOM slots.
 */
export function projectSlots(shadowHtml: string, lightChildren: Array<{ slot?: string; content: string }>): { projectedShadow: string; lightRemainder: string } {
  let projected = shadowHtml;
  const assignedLightIndices = new Set<number>();

  let iterations = 0;
  const maxIterations = 5;

  while (iterations < maxIterations) {
    let replaced = false;
    let scanPos = 0;
    let nextHtml = '';

    while (scanPos < projected.length) {
      const slotMatch = findNextSlot(projected, scanPos);
      if (!slotMatch) {
        nextHtml += projected.slice(scanPos);
        break;
      }

      nextHtml += projected.slice(scanPos, slotMatch.matchIndex);
      replaced = true;

      const attrs = slotMatch.attrsStr.trim();
      const rawSlotName = extractNameFromSlotTag(attrs);
      const slotName = rawSlotName ? rawSlotName.trim() : '';
      const fallbackContent = slotMatch.fallbackContent || '';

      const matchedChildren: string[] = [];

      if (slotName) {
        // Named slot: match light children with matching slot attribute
        lightChildren.forEach((child, index) => {
          if (child.slot === slotName && !assignedLightIndices.has(index)) {
            matchedChildren.push(child.content);
            assignedLightIndices.add(index);
          }
        });
      } else {
        // Default slot: match light children with no slot attribute or empty slot attribute
        lightChildren.forEach((child, index) => {
          const childSlot = (child.slot || '').trim();
          if (!childSlot && !assignedLightIndices.has(index)) {
            matchedChildren.push(child.content);
            assignedLightIndices.add(index);
          }
        });
      }

      const replacement = matchedChildren.length > 0 ? escapeUnclosedTemplateTags(matchedChildren.join('')) : fallbackContent;

      nextHtml += replacement;
      scanPos = slotMatch.matchIndex + slotMatch.fullLength;
    }

    projected = nextHtml;
    iterations++;
    if (!replaced || !/<slot\b/i.test(projected)) {
      break;
    }
  }

  // Light DOM elements that were not projected into slots remain as light DOM
  const lightRemainder = lightChildren
    .filter((_, index) => !assignedLightIndices.has(index))
    .map((c) => c.content)
    .join('');

  return { projectedShadow: projected, lightRemainder };
}
