/**
 * Clean Declarative Shadow DOM renderer for @lit-core/ssr.
 * Emits native <template shadowrootmode="open"> with 100% zero <!--lit-part--> comments.
 */

import { CompilerBridge, escapeAttribute, escapeHtml, isCompiledTemplateResult, isNothing, isStandardTemplateResult, resolveDirectiveValue, type SsrRenderContext } from './compiler-bridge.js';
import { type CustomElementRegistryLike, installIsolateGlobals } from './environment.js';
import { escapeUnclosedTemplateTags, extractNameFromSlotTag, extractSlotNameFromTag, findNextSlot, projectSlots, SlotManager } from './slot.js';

export interface RenderOptions {
  /**
   * Render output mode:
   * - 'dsd' (default): Native Declarative Shadow DOM (<template shadowrootmode="open">).
   * - 'flattened': Flattens shadow roots and slots into semantic light DOM (SEO / crawlers).
   * @default 'dsd'
   */
  mode?: 'dsd' | 'flattened';

  /**
   * Scoped custom element registry to resolve component constructors during render.
   */
  customElements?: CustomElementRegistryLike;

  /**
   * Enable @lit-core/resumable state snapshots (<script type="lit/state">)
   * and listener resumes-on-* attributes.
   * @default true
   */
  resumable?: boolean;

  /**
   * Enable @lit-core/dom-paths clean DSD mode, emitting zero <!--lit-part--> comments.
   * @default true
   */
  domPaths?: boolean;

  /**
   * Deduplicate CSS styles using @lit-core/css-fuse constructable stylesheet references.
   * @default true
   */
  cssFuse?: boolean;

  /**
   * Optional server state dictionary injected into the rendering context.
   */
  state?: Record<string, unknown>;

  /**
   * Maximum recursion depth for nested custom elements and subtemplates.
   * @default 100
   */
  depth?: number;
}

// Opcode interface for standard TemplateResult WeakMap cache
interface StandardTemplateOpcode {
  type: 'static' | 'child' | 'attr' | 'boolean-attr' | 'event-attr' | 'prop-attr' | 'custom-element';
  text?: string;
  name?: string;
  quote?: string;
  index: number;
  tagName?: string;
  attrsStr?: string;
  isSelfClosing?: boolean;
  childrenOpcodes?: StandardTemplateOpcode[];
  attrsOpcodes?: StandardTemplateOpcode[];
}

const standardOpcodeCache = new WeakMap<TemplateStringsArray, StandardTemplateOpcode[]>();
const tokenRegexCache = new Map<string, RegExp>();

function getTokenRegex(tagName: string): RegExp {
  let re = tokenRegexCache.get(tagName);
  if (!re) {
    const escapedTag = tagName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    re = new RegExp(`<(\\/)?\\s*(${escapedTag})(?=[\\s>/]|$)`, 'gi');
    tokenRegexCache.set(tagName, re);
  }
  return re;
}

function structureCustomElements(opcodes: StandardTemplateOpcode[]): StandardTemplateOpcode[] {
  const result: StandardTemplateOpcode[] = [];
  let i = 0;

  while (i < opcodes.length) {
    const op = opcodes[i];

    if (op.type !== 'static' || !op.text) {
      result.push(op);
      i++;
      continue;
    }

    const text = op.text;
    const customTagRegex = /<([a-z][a-z0-9._-]*-[a-z0-9._-]*)(?=[\s>/]|$)/gi;
    const match = customTagRegex.exec(text);

    if (!match) {
      result.push(op);
      i++;
      continue;
    }

    const tagStartIndex = match.index;
    const tagName = match[1].toLowerCase();

    if (tagStartIndex > 0) {
      result.push({
        type: 'static',
        text: text.slice(0, tagStartIndex),
        index: -1,
      });
    }

    const attrStartIndex = tagStartIndex + 1 + match[1].length;
    let inQuote: '"' | "'" | null = null;
    let openTagEnd = -1;
    let isSelfClosing = false;

    for (let c = attrStartIndex; c < text.length; c++) {
      const ch = text[c];
      if (inQuote) {
        if (ch === inQuote) inQuote = null;
      } else if (ch === '"' || ch === "'") {
        inQuote = ch;
      } else if (ch === '>') {
        openTagEnd = c;
        if (c > attrStartIndex && text[c - 1] === '/') {
          isSelfClosing = true;
        }
        break;
      }
    }

    const attrsOpcodes: StandardTemplateOpcode[] = [];
    let openTagOpIndex = i;
    let restOfOpenTagChunk = '';
    let attrsStr = '';

    if (openTagEnd !== -1) {
      attrsStr = isSelfClosing ? text.slice(attrStartIndex, openTagEnd - 1) : text.slice(attrStartIndex, openTagEnd);
      if (attrsStr.length > 0) {
        attrsOpcodes.push({ type: 'static', text: attrsStr, index: -1 });
      }
      restOfOpenTagChunk = text.slice(openTagEnd + 1);
    } else {
      // Opening tag spans across dynamic attribute opcodes or subsequent static chunks
      const initialAttrs = text.slice(attrStartIndex);
      if (initialAttrs.length > 0) {
        attrsOpcodes.push({ type: 'static', text: initialAttrs, index: -1 });
      }

      let scanJ = i + 1;
      let foundEnd = false;

      while (scanJ < opcodes.length) {
        const nextOp = opcodes[scanJ];
        if (nextOp.type !== 'static' || !nextOp.text) {
          attrsOpcodes.push(nextOp);
          scanJ++;
          continue;
        }

        const nextText = nextOp.text;
        let foundInNext = -1;
        for (let c = 0; c < nextText.length; c++) {
          const ch = nextText[c];
          if (inQuote) {
            if (ch === inQuote) inQuote = null;
          } else if (ch === '"' || ch === "'") {
            inQuote = ch;
          } else if (ch === '>') {
            foundInNext = c;
            if (c > 0 && nextText[c - 1] === '/') {
              isSelfClosing = true;
            }
            break;
          }
        }

        if (foundInNext !== -1) {
          foundEnd = true;
          openTagOpIndex = scanJ;
          const preEndText = isSelfClosing ? nextText.slice(0, foundInNext - 1) : nextText.slice(0, foundInNext);
          if (preEndText.length > 0) {
            attrsOpcodes.push({ type: 'static', text: preEndText, index: -1 });
          }
          restOfOpenTagChunk = nextText.slice(foundInNext + 1);
          break;
        } else {
          attrsOpcodes.push(nextOp);
          scanJ++;
        }
      }

      if (!foundEnd) {
        result.push({
          type: 'static',
          text: text.slice(tagStartIndex),
          index: -1,
        });
        i++;
        continue;
      }
    }

    if (isSelfClosing) {
      result.push({
        type: 'custom-element',
        tagName,
        attrsStr,
        attrsOpcodes,
        isSelfClosing: true,
        childrenOpcodes: [],
        index: -1,
      });

      if (restOfOpenTagChunk.length > 0) {
        opcodes[openTagOpIndex] = { type: 'static', text: restOfOpenTagChunk, index: -1 };
        i = openTagOpIndex;
      } else {
        i = openTagOpIndex + 1;
      }
      continue;
    }

    // Non-self-closing: balance depth to find matching </tagName>
    let depth = 1;
    const innerChildrenOpcodes: StandardTemplateOpcode[] = [];
    const currentRest = restOfOpenTagChunk;

    const tokenRegex = getTokenRegex(tagName);
    tokenRegex.lastIndex = 0;

    let foundClose = false;
    let closeIndexInRest = -1;
    let closeEndInRest = -1;

    let tokenMatch = tokenRegex.exec(currentRest);
    while (tokenMatch !== null) {
      const isClose = tokenMatch[1] === '/';
      const tIdx = tokenMatch.index;

      let tInQuote: '"' | "'" | null = null;
      let tEnd = -1;
      let tSelfClose = false;
      for (let j = tIdx; j < currentRest.length; j++) {
        const c = currentRest[j];
        if (tInQuote) {
          if (c === tInQuote) tInQuote = null;
        } else if (c === '"' || c === "'") {
          tInQuote = c;
        } else if (c === '>') {
          tEnd = j;
          if (j > tIdx && currentRest[j - 1] === '/') tSelfClose = true;
          break;
        }
      }
      if (tEnd === -1) break;

      if (isClose) {
        depth--;
        if (depth === 0) {
          foundClose = true;
          closeIndexInRest = tIdx;
          closeEndInRest = tEnd + 1;
          break;
        }
      } else if (!tSelfClose) {
        depth++;
      }

      tokenRegex.lastIndex = tEnd + 1;
      tokenMatch = tokenRegex.exec(currentRest);
    }

    if (foundClose) {
      const innerText = currentRest.slice(0, closeIndexInRest);
      if (innerText.length > 0) {
        innerChildrenOpcodes.push({ type: 'static', text: innerText, index: -1 });
      }

      result.push({
        type: 'custom-element',
        tagName,
        attrsStr,
        attrsOpcodes,
        isSelfClosing: false,
        childrenOpcodes: structureCustomElements(innerChildrenOpcodes),
        index: -1,
      });

      const afterClose = currentRest.slice(closeEndInRest);
      if (afterClose.length > 0) {
        opcodes[openTagOpIndex] = { type: 'static', text: afterClose, index: -1 };
        i = openTagOpIndex;
      } else {
        i = openTagOpIndex + 1;
      }
      continue;
    }

    // Matching closing tag spans across opcodes
    if (currentRest.length > 0) {
      innerChildrenOpcodes.push({ type: 'static', text: currentRest, index: -1 });
    }

    let j = openTagOpIndex + 1;
    let matchedAcross = false;

    while (j < opcodes.length) {
      const nextOp = opcodes[j];
      if (nextOp.type !== 'static' || !nextOp.text) {
        innerChildrenOpcodes.push(nextOp);
        j++;
        continue;
      }

      const nextText = nextOp.text;
      const subTokenRegex = getTokenRegex(tagName);
      subTokenRegex.lastIndex = 0;

      let subMatch = subTokenRegex.exec(nextText);
      let subCloseFound = false;
      let subCloseStart = -1;
      let subCloseEnd = -1;

      while (subMatch !== null) {
        const isClose = subMatch[1] === '/';
        const tIdx = subMatch.index;

        let tInQuote: '"' | "'" | null = null;
        let tEnd = -1;
        let tSelfClose = false;
        for (let k = tIdx; k < nextText.length; k++) {
          const c = nextText[k];
          if (tInQuote) {
            if (c === tInQuote) tInQuote = null;
          } else if (c === '"' || c === "'") {
            tInQuote = c;
          } else if (c === '>') {
            tEnd = k;
            if (k > tIdx && nextText[k - 1] === '/') tSelfClose = true;
            break;
          }
        }
        if (tEnd === -1) break;

        if (isClose) {
          depth--;
          if (depth === 0) {
            subCloseFound = true;
            subCloseStart = tIdx;
            subCloseEnd = tEnd + 1;
            break;
          }
        } else if (!tSelfClose) {
          depth++;
        }

        subTokenRegex.lastIndex = tEnd + 1;
        subMatch = subTokenRegex.exec(nextText);
      }

      if (subCloseFound) {
        const beforeClose = nextText.slice(0, subCloseStart);
        if (beforeClose.length > 0) {
          innerChildrenOpcodes.push({ type: 'static', text: beforeClose, index: -1 });
        }

        result.push({
          type: 'custom-element',
          tagName,
          attrsStr,
          attrsOpcodes,
          isSelfClosing: false,
          childrenOpcodes: structureCustomElements(innerChildrenOpcodes),
          index: -1,
        });

        const afterClose = nextText.slice(subCloseEnd);
        if (afterClose.length > 0) {
          opcodes[j] = { type: 'static', text: afterClose, index: -1 };
          i = j;
        } else {
          i = j + 1;
        }
        matchedAcross = true;
        break;
      } else {
        innerChildrenOpcodes.push(nextOp);
        j++;
      }
    }

    if (!matchedAcross) {
      result.push({
        type: 'static',
        text: text.slice(tagStartIndex),
        index: -1,
      });
      i++;
    }
  }

  return result;
}

interface TagScannerState {
  inTag: boolean;
  inQuote: '"' | "'" | null;
  inComment: boolean;
  inCloseTag: boolean;
}

function advanceTagState(text: string, state: TagScannerState): void {
  const len = text.length;
  let j = 0;
  while (j < len) {
    if (state.inComment) {
      if (text.startsWith('-->', j)) {
        state.inComment = false;
        j += 3;
      } else {
        j++;
      }
    } else if (state.inQuote) {
      if (text[j] === state.inQuote) {
        state.inQuote = null;
      }
      j++;
    } else if (state.inCloseTag) {
      if (text[j] === '>') {
        state.inCloseTag = false;
      }
      j++;
    } else if (state.inTag) {
      const ch = text[j];
      if (ch === '"' || ch === "'") {
        state.inQuote = ch;
      } else if (ch === '>') {
        state.inTag = false;
      }
      j++;
    } else {
      if (text.startsWith('<!--', j)) {
        state.inComment = true;
        j += 4;
      } else if (text.startsWith('</', j) || text.startsWith('<!', j)) {
        state.inCloseTag = true;
        j += 2;
      } else if (text[j] === '<' && j + 1 < len && /[a-zA-Z]/.test(text[j + 1])) {
        state.inTag = true;
        j++;
      } else {
        j++;
      }
    }
  }
}

function compileStandardTemplateOpcodes(strings: TemplateStringsArray): StandardTemplateOpcode[] {
  let opcodes = standardOpcodeCache.get(strings);
  if (opcodes) return opcodes;

  opcodes = [];
  const count = strings.length;
  let skipLeadingQuote = false;
  const tagState: TagScannerState = {
    inTag: false,
    inQuote: null,
    inComment: false,
    inCloseTag: false,
  };

  for (let i = 0; i < count; i++) {
    let quasi = strings[i];
    if (skipLeadingQuote) {
      if (quasi.startsWith('"') || quasi.startsWith("'")) {
        quasi = quasi.slice(1);
      }
      skipLeadingQuote = false;
      tagState.inQuote = null;
    }

    if (i < count - 1) {
      // Analyze position of expression following strings[i]
      // Check if we are inside an HTML tag attribute
      const attrMatch = /([ \t\r\n]+)([?@.]?[\w\-.:]+)\s*=\s*(["'])?$/i.exec(quasi);
      if (attrMatch) {
        const preAttrText = quasi.slice(0, attrMatch.index);
        const checkpoint: TagScannerState = { ...tagState };
        advanceTagState(preAttrText, checkpoint);

        if (checkpoint.inTag && !checkpoint.inQuote && !checkpoint.inComment && !checkpoint.inCloseTag) {
          tagState.inTag = true;
          tagState.inQuote = null;
          tagState.inComment = false;
          tagState.inCloseTag = false;

          const rawName = attrMatch[2];
          const quote = attrMatch[3] || '';

          if (preAttrText.length > 0) {
            opcodes.push({ type: 'static', text: preAttrText, index: -1 });
          }

          if (quote) {
            skipLeadingQuote = true;
          }

          if (rawName.startsWith('?')) {
            opcodes.push({
              type: 'boolean-attr',
              name: rawName.slice(1),
              quote,
              index: i,
            });
          } else if (rawName.startsWith('@')) {
            opcodes.push({
              type: 'event-attr',
              name: rawName.slice(1),
              quote,
              index: i,
            });
          } else if (rawName.startsWith('.')) {
            opcodes.push({
              type: 'prop-attr',
              name: rawName.slice(1),
              quote,
              index: i,
            });
          } else {
            opcodes.push({
              type: 'attr',
              name: rawName,
              quote,
              index: i,
            });
          }
          continue;
        }
      }

      // Default: child expression
      advanceTagState(quasi, tagState);

      if (quasi.length > 0) {
        opcodes.push({ type: 'static', text: quasi, index: -1 });
      }
      opcodes.push({ type: 'child', index: i });
    } else {
      // Last quasi
      if (quasi.length > 0) {
        opcodes.push({ type: 'static', text: quasi, index: -1 });
      }
    }
  }

  const structured = structureCustomElements(opcodes);
  standardOpcodeCache.set(strings, structured);
  return structured;
}

export function* render(value: unknown, options: RenderOptions = {}): IterableIterator<string> {
  installIsolateGlobals();

  const registry: CustomElementRegistryLike = options.customElements ?? (globalThis as any).customElements;
  const mode = options.mode ?? 'dsd';
  const slotManager = new SlotManager();
  const compilerBridge = new CompilerBridge();

  const maxDepth = options.depth ?? 100;

  const context: SsrRenderContext = {
    depth: 0,
    resumable: options.resumable ?? true,
    domPaths: Boolean(options.domPaths),
    cssFuse: options.cssFuse ?? true,
    mode,
    customElements: registry,
    state: options.state,
    styleDeduplicator: compilerBridge.styleDeduplicator,
    compilerBridge,
    renderValue: (val, ctx) => renderInternal(val, ctx, maxDepth, slotManager),
  };

  yield* renderInternal(value, context, maxDepth, slotManager);
}

function* renderInternal(value: unknown, context: SsrRenderContext, maxDepth: number, slotManager: SlotManager): IterableIterator<string> {
  if (context.depth > maxDepth) {
    throw new RangeError('Maximum SSR render depth exceeded');
  }

  // 1. Null, undefined, Lit sentinels
  if (value === null || value === undefined || isNothing(value)) {
    return;
  }

  // 2. String, number, bigint, boolean
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint' || typeof value === 'boolean') {
    yield escapeHtml(String(value));
    return;
  }

  // 3. Arrays / Iterables
  if (
    Array.isArray(value) ||
    (typeof value === 'object' &&
      value !== null &&
      Symbol.iterator in value &&
      typeof (value as any)[Symbol.iterator] === 'function' &&
      !isCompiledTemplateResult(value) &&
      !isStandardTemplateResult(value) &&
      !('tagName' in value && typeof (value as any).tagName === 'string') &&
      !('html' in value && typeof (value as any).html === 'string') &&
      !('template' in value && typeof (value as any).template === 'string') &&
      typeof (value as any)?.render !== 'function')
  ) {
    context.depth++;
    try {
      for (const item of value as Iterable<unknown>) {
        yield* renderInternal(item, context, maxDepth, slotManager);
      }
    } finally {
      context.depth--;
    }
    return;
  }

  // 4. Ingestion of @lit-core/html-aot compiled template result
  if (isCompiledTemplateResult(value)) {
    context.depth++;
    try {
      yield* context.compilerBridge.renderCompiledTemplate(value, context);
    } finally {
      context.depth--;
    }
    return;
  }

  // 5. Standard Lit TemplateResult
  if (isStandardTemplateResult(value)) {
    context.depth++;
    try {
      yield* renderStandardTemplate(value, context, maxDepth, slotManager);
    } finally {
      context.depth--;
    }
    return;
  }

  // 6. Custom Element instance or object with render() method
  if (typeof (value as any)?.render === 'function') {
    context.depth++;
    try {
      yield* renderComponentInstance(value, context, maxDepth, slotManager);
    } finally {
      context.depth--;
    }
    return;
  }

  // 7. Component descriptor (declarative component object with tagName)
  if (typeof value === 'object' && value !== null && 'tagName' in value && typeof (value as any).tagName === 'string') {
    context.depth++;
    try {
      yield* renderComponentDescriptor(value as any, context, maxDepth, slotManager);
    } finally {
      context.depth--;
    }
    return;
  }

  // 8. Pre-compiled descriptor with html or template property
  if (typeof value === 'object' && value !== null && (('html' in value && typeof (value as any).html === 'string') || ('template' in value && typeof (value as any).template === 'string'))) {
    const htmlStr = (value as any).html ?? (value as any).template ?? '';
    yield String(htmlStr);
    return;
  }

  // 9. Generic object fallback
  yield escapeHtml(String(value));
}

function* renderOpcodes(opcodes: StandardTemplateOpcode[], values: unknown[], context: SsrRenderContext, maxDepth: number, slotManager: SlotManager): IterableIterator<string> {
  for (const op of opcodes) {
    switch (op.type) {
      case 'static': {
        const text = op.text ?? '';
        // Check for opening custom element tags in static HTML text
        yield* processStaticHtmlChunk(text, context, maxDepth, slotManager);
        break;
      }
      case 'child': {
        const rawVal = op.index < values.length ? values[op.index] : undefined;
        const resolved = resolveDirectiveValue(rawVal, { type: 2 });
        yield* renderInternal(resolved, context, maxDepth, slotManager);
        break;
      }
      case 'attr': {
        const rawVal = op.index < values.length ? values[op.index] : undefined;
        const resolved = resolveDirectiveValue(rawVal, { type: 1, name: op.name });
        if (!isNothing(resolved) && resolved !== null && resolved !== undefined) {
          yield ` ${op.name}="${escapeAttribute(String(resolved))}"`;
        }
        break;
      }
      case 'boolean-attr': {
        const rawVal = op.index < values.length ? values[op.index] : undefined;
        const resolved = resolveDirectiveValue(rawVal, { type: 4, name: op.name });
        if (resolved && !isNothing(resolved)) {
          yield ` ${op.name}`;
        }
        break;
      }
      case 'event-attr': {
        const rawVal = op.index < values.length ? values[op.index] : undefined;
        const resolved = resolveDirectiveValue(rawVal, { type: 5, name: op.name });
        if (context.resumable && op.name && !isNothing(resolved)) {
          yield ` resumes-on-${op.name}`;
        }
        break;
      }
      case 'prop-attr': {
        // Property binding: does not emit DOM attribute
        break;
      }
      case 'custom-element': {
        const Ctor = context.customElements?.get(op.tagName || '');
        let renderedAttrs = op.attrsStr || '';
        if (op.attrsOpcodes && op.attrsOpcodes.length > 0) {
          renderedAttrs = '';
          for (const chunk of renderOpcodes(op.attrsOpcodes, values, context, maxDepth, slotManager)) {
            renderedAttrs += chunk;
          }
        }

        if (Ctor) {
          let innerHtml = '';
          for (const chunk of renderOpcodes(op.childrenOpcodes || [], values, context, maxDepth, slotManager)) {
            innerHtml += chunk;
          }
          yield* renderCustomElementWithInnerHtml(op.tagName || '', Ctor, renderedAttrs, innerHtml, context, maxDepth, slotManager, true, op.attrsOpcodes, values);
        } else {
          if (op.isSelfClosing) {
            yield `<${op.tagName}${renderedAttrs}/>`;
          } else {
            yield `<${op.tagName}${renderedAttrs}>`;
            yield* renderOpcodes(op.childrenOpcodes || [], values, context, maxDepth, slotManager);
            yield `</${op.tagName}>`;
          }
        }
        break;
      }
    }
  }
}

function* renderStandardTemplate(result: { strings: TemplateStringsArray; values: unknown[] }, context: SsrRenderContext, maxDepth: number, slotManager: SlotManager): IterableIterator<string> {
  const opcodes = compileStandardTemplateOpcodes(result.strings);
  const values = result.values || [];
  yield* renderOpcodes(opcodes, values, context, maxDepth, slotManager);
}

function defineElementProperty(target: any, prop: string, value: any): void {
  try {
    target[prop] = value;
  } catch {
    try {
      Object.defineProperty(target, prop, {
        value,
        configurable: true,
        writable: true,
        enumerable: true,
      });
    } catch {
      // Ignore if property is locked
    }
  }
}

interface CustomElementMatch {
  matchIndex: number;
  fullLength: number;
  tagName: string;
  attrsStr: string;
  innerHtml: string;
  isSelfClosing: boolean;
}

function findNextCustomElement(chunk: string, startIndex: number): CustomElementMatch | null {
  // Matches <tag-name with one or more hyphens delimited by whitespace, >, or /
  const customTagStartRegex = /<([a-z][a-z0-9._-]*-[a-z0-9._-]*)(?=[\s>/])/gi;
  customTagStartRegex.lastIndex = startIndex;

  while (true) {
    const match = customTagStartRegex.exec(chunk);
    if (!match) return null;

    const pos = match.index;
    const tagName = match[1].toLowerCase();
    const attrStart = pos + 1 + match[1].length;

    // Scan for closing > of the opening tag while respecting quotes
    let inQuote: '"' | "'" | null = null;
    let tagEnd = -1;
    let isSelfClosing = false;

    for (let i = attrStart; i < chunk.length; i++) {
      const ch = chunk[i];
      if (inQuote) {
        if (ch === inQuote) inQuote = null;
      } else if (ch === '"' || ch === "'") {
        inQuote = ch;
      } else if (ch === '>') {
        tagEnd = i;
        if (i > attrStart && chunk[i - 1] === '/') {
          isSelfClosing = true;
        }
        break;
      }
    }

    if (tagEnd === -1) {
      // Malformed or unclosed opening tag, advance search
      customTagStartRegex.lastIndex = pos + 1;
      continue;
    }

    const attrsStr = isSelfClosing ? chunk.slice(attrStart, tagEnd - 1) : chunk.slice(attrStart, tagEnd);

    if (isSelfClosing) {
      return {
        matchIndex: pos,
        fullLength: tagEnd + 1 - pos,
        tagName,
        attrsStr,
        innerHtml: '',
        isSelfClosing: true,
      };
    }

    // Balance depth for matching closing tag: </tagName>
    let depth = 1;
    const scanPos = tagEnd + 1;
    let closeTagStart = -1;
    let closeTagEnd = -1;

    const tokenRegex = getTokenRegex(tagName);
    tokenRegex.lastIndex = scanPos;

    let tokenMatch = tokenRegex.exec(chunk);
    while (tokenMatch !== null) {
      const isClose = tokenMatch[1] === '/';
      const tokenIndex = tokenMatch.index;

      // Find the closing > of this matching token tag
      let innerInQuote: '"' | "'" | null = null;
      let innerTagEnd = -1;
      let innerSelfClosing = false;

      for (let j = tokenIndex; j < chunk.length; j++) {
        const c = chunk[j];
        if (innerInQuote) {
          if (c === innerInQuote) innerInQuote = null;
        } else if (c === '"' || c === "'") {
          innerInQuote = c;
        } else if (c === '>') {
          innerTagEnd = j;
          if (j > tokenIndex && chunk[j - 1] === '/') {
            innerSelfClosing = true;
          }
          break;
        }
      }

      if (innerTagEnd === -1) break;

      if (isClose) {
        depth--;
        if (depth === 0) {
          closeTagStart = tokenIndex;
          closeTagEnd = innerTagEnd + 1;
          break;
        }
      } else if (!innerSelfClosing) {
        depth++;
      }

      tokenRegex.lastIndex = innerTagEnd + 1;
      tokenMatch = tokenRegex.exec(chunk);
    }

    if (closeTagStart !== -1) {
      const innerHtml = chunk.slice(tagEnd + 1, closeTagStart);
      return {
        matchIndex: pos,
        fullLength: closeTagEnd - pos,
        tagName,
        attrsStr,
        innerHtml,
        isSelfClosing: false,
      };
    }

    // Unmatched closing tag, advance and continue search
    customTagStartRegex.lastIndex = pos + 1;
  }
}

interface ParsedChunkSegment {
  staticText?: string;
  customElement?: {
    tagName: string;
    attrsStr: string;
    innerHtml: string;
    isSelfClosing: boolean;
  };
}

const staticChunkParseCache = new Map<string, ParsedChunkSegment[]>();

function parseStaticChunkSegments(chunk: string): ParsedChunkSegment[] {
  let cached = staticChunkParseCache.get(chunk);
  if (cached) return cached;

  if (chunk.indexOf('<') === -1 || chunk.indexOf('-') === -1) {
    cached = [{ staticText: chunk }];
    staticChunkParseCache.set(chunk, cached);
    return cached;
  }

  const segments: ParsedChunkSegment[] = [];
  let lastIndex = 0;
  while (true) {
    const match = findNextCustomElement(chunk, lastIndex);
    if (!match) break;

    if (match.matchIndex > lastIndex) {
      segments.push({ staticText: chunk.slice(lastIndex, match.matchIndex) });
    }

    segments.push({
      customElement: {
        tagName: match.tagName,
        attrsStr: match.attrsStr,
        innerHtml: match.innerHtml,
        isSelfClosing: match.isSelfClosing,
      },
    });

    lastIndex = match.matchIndex + match.fullLength;
  }

  if (lastIndex < chunk.length) {
    segments.push({ staticText: chunk.slice(lastIndex) });
  }

  if (staticChunkParseCache.size < 5000) {
    staticChunkParseCache.set(chunk, segments);
  }
  return segments;
}

interface ParsedAttr {
  name: string;
  value: string;
  camelProp: string;
}

const parsedAttrsCache = new Map<string, ParsedAttr[]>();

function getParsedAttrs(attrsStr: string): ParsedAttr[] {
  let cached = parsedAttrsCache.get(attrsStr);
  if (cached) return cached;

  cached = [];
  const attrRegex = /([\w\-.:?@]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  let attrMatch = attrRegex.exec(attrsStr);
  while (attrMatch !== null) {
    const name = attrMatch[1];
    const value = attrMatch[2] ?? attrMatch[3] ?? attrMatch[4] ?? '';
    const camelProp = name.replace(/-([a-z])/g, (_, g) => g.toUpperCase());
    cached.push({ name, value, camelProp });
    attrMatch = attrRegex.exec(attrsStr);
  }

  if (parsedAttrsCache.size < 5000) {
    parsedAttrsCache.set(attrsStr, cached);
  }
  return cached;
}

interface ParsedSlottedNode {
  slotName: string;
  content: string;
  tagName?: string;
}

const innerHtmlSlottedCache = new Map<string, ParsedSlottedNode[]>();

function getParsedSlottedNodes(innerHtml: string): ParsedSlottedNode[] {
  let cached = innerHtmlSlottedCache.get(innerHtml);
  if (cached) return cached;

  cached = [];
  const trimmed = innerHtml.trim();
  if (trimmed.length === 0) {
    if (innerHtmlSlottedCache.size < 5000) innerHtmlSlottedCache.set(innerHtml, cached);
    return cached;
  }

  let pos = 0;
  const len = innerHtml.length;
  const tagStartRegex = /<([a-z][a-z0-9._-]*)(?=[\s>/])/gi;

  while (pos < len) {
    tagStartRegex.lastIndex = pos;
    const match = tagStartRegex.exec(innerHtml);

    if (!match) {
      const remainingText = innerHtml.slice(pos).trim();
      if (remainingText.length > 0) {
        cached.push({ slotName: '', content: remainingText });
      }
      break;
    }

    if (match.index > pos) {
      const textBefore = innerHtml.slice(pos, match.index).trim();
      if (textBefore.length > 0) {
        cached.push({ slotName: '', content: textBefore });
      }
    }

    const tagStartIndex = match.index;
    const tagName = match[1].toLowerCase();
    const attrStartIndex = tagStartIndex + 1 + match[1].length;

    let inQuote: '"' | "'" | null = null;
    let openTagEnd = -1;
    let isSelfClosing = false;

    for (let i = attrStartIndex; i < len; i++) {
      const ch = innerHtml[i];
      if (inQuote) {
        if (ch === inQuote) inQuote = null;
      } else if (ch === '"' || ch === "'") {
        inQuote = ch;
      } else if (ch === '>') {
        openTagEnd = i;
        if (i > attrStartIndex && innerHtml[i - 1] === '/') {
          isSelfClosing = true;
        }
        break;
      }
    }

    if (openTagEnd === -1) {
      const remaining = innerHtml.slice(tagStartIndex).trim();
      if (remaining.length > 0) {
        cached.push({ slotName: '', content: remaining });
      }
      break;
    }

    const attrsStr = isSelfClosing ? innerHtml.slice(attrStartIndex, openTagEnd - 1) : innerHtml.slice(attrStartIndex, openTagEnd);
    const slotName = extractSlotNameFromTag(attrsStr) ?? '';

    const isVoidElement = /^(area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)$/i.test(tagName);

    if (isSelfClosing || isVoidElement) {
      const fullContent = innerHtml.slice(tagStartIndex, openTagEnd + 1);
      cached.push({ slotName, content: fullContent, tagName });
      pos = openTagEnd + 1;
      continue;
    }

    // Depth-balanced search for closing tag
    let depth = 1;
    const scanPos = openTagEnd + 1;
    let closeTagEnd = -1;

    const tokenRegex = getTokenRegex(tagName);
    tokenRegex.lastIndex = scanPos;

    let tokenMatch = tokenRegex.exec(innerHtml);
    while (tokenMatch !== null) {
      const isClose = tokenMatch[1] === '/';
      const tokenIndex = tokenMatch.index;

      let innerInQuote: '"' | "'" | null = null;
      let innerTagEnd = -1;
      let innerSelfClosing = false;

      for (let j = tokenIndex; j < len; j++) {
        const c = innerHtml[j];
        if (innerInQuote) {
          if (c === innerInQuote) innerInQuote = null;
        } else if (c === '"' || c === "'") {
          innerInQuote = c;
        } else if (c === '>') {
          innerTagEnd = j;
          if (j > tokenIndex && innerHtml[j - 1] === '/') {
            innerSelfClosing = true;
          }
          break;
        }
      }

      if (innerTagEnd === -1) break;

      if (isClose) {
        depth--;
        if (depth === 0) {
          closeTagEnd = innerTagEnd + 1;
          break;
        }
      } else if (!innerSelfClosing) {
        depth++;
      }

      tokenRegex.lastIndex = innerTagEnd + 1;
      tokenMatch = tokenRegex.exec(innerHtml);
    }

    if (closeTagEnd !== -1) {
      const fullContent = innerHtml.slice(tagStartIndex, closeTagEnd);
      cached.push({ slotName, content: fullContent, tagName });
      pos = closeTagEnd;
    } else {
      const fullContent = innerHtml.slice(tagStartIndex, openTagEnd + 1);
      cached.push({ slotName, content: fullContent, tagName });
      pos = openTagEnd + 1;
    }
  }

  if (innerHtmlSlottedCache.size < 5000) {
    innerHtmlSlottedCache.set(innerHtml, cached);
  }
  return cached;
}

function* processStaticHtmlChunk(chunk: string, context: SsrRenderContext, maxDepth: number, slotManager: SlotManager): IterableIterator<string> {
  // If in flattened mode, handle <slot> tag replacement
  if (context.mode === 'flattened' && chunk.includes('<slot')) {
    yield* processFlattenedSlots(chunk, context, maxDepth, slotManager);
    return;
  }

  const segments = parseStaticChunkSegments(chunk);
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (seg.staticText !== undefined) {
      yield seg.staticText;
    } else if (seg.customElement !== undefined) {
      const el = seg.customElement;
      const Ctor = context.customElements?.get(el.tagName);
      if (Ctor) {
        yield* renderCustomElementWithInnerHtml(el.tagName, Ctor, el.attrsStr, el.innerHtml, context, maxDepth, slotManager);
      } else {
        if (el.isSelfClosing) {
          yield `<${el.tagName}${el.attrsStr}/>`;
        } else {
          yield `<${el.tagName}${el.attrsStr}>`;
          if (el.innerHtml.length > 0) {
            yield* processStaticHtmlChunk(el.innerHtml, context, maxDepth, slotManager);
          }
          yield `</${el.tagName}>`;
        }
      }
    }
  }
}

function* processFlattenedSlots(chunk: string, context: SsrRenderContext, maxDepth: number, slotManager: SlotManager): IterableIterator<string> {
  let scanPos = 0;
  const currentCtx = slotManager.currentContext;

  while (scanPos < chunk.length) {
    const slotMatch = findNextSlot(chunk, scanPos);
    if (!slotMatch) {
      yield chunk.slice(scanPos);
      break;
    }

    if (slotMatch.matchIndex > scanPos) {
      yield chunk.slice(scanPos, slotMatch.matchIndex);
    }

    const attrs = slotMatch.attrsStr.trim();
    const fallback = slotMatch.fallbackContent || '';
    const rawName = extractNameFromSlotTag(attrs);
    const slotName = (rawName ? rawName.trim() : '').trim();

    if (currentCtx?.hasAssignedNodes(slotName)) {
      const assigned = currentCtx.getAssignedNodes(slotName);
      for (const node of assigned) {
        if (typeof node.content === 'string') {
          yield* processStaticHtmlChunk(node.content, context, maxDepth, slotManager);
        } else {
          yield* renderInternal(node.content, context, maxDepth, slotManager);
        }
      }
    } else if (fallback.trim().length > 0) {
      yield fallback;
    }

    scanPos = slotMatch.matchIndex + slotMatch.fullLength;
  }
}

function* renderCustomElementWithInnerHtml(
  tagName: string,
  Ctor: new () => any,
  attrsStr: string,
  innerHtml: string,
  context: SsrRenderContext,
  maxDepth: number,
  slotManager: SlotManager,
  isAlreadyExpanded = false,
  attrsOpcodes?: StandardTemplateOpcode[],
  values?: unknown[],
): IterableIterator<string> {
  if (context.depth >= maxDepth) {
    throw new RangeError('Maximum SSR render depth exceeded');
  }

  const instance = new Ctor();
  defineElementProperty(instance, 'tagName', tagName.toUpperCase());
  defineElementProperty(instance, 'isConnected', true);
  if (typeof instance.enableUpdating === 'function') {
    defineElementProperty(instance, 'enableUpdating', () => {});
  }

  // Parse static attributes from attrsStr
  const parsedAttrs = getParsedAttrs(attrsStr);
  for (let i = 0; i < parsedAttrs.length; i++) {
    const { name, value, camelProp } = parsedAttrs[i];
    if (typeof instance.setAttribute === 'function') {
      instance.setAttribute(name, value);
    }
    if (camelProp in instance && typeof (instance as any)[camelProp] !== 'function') {
      (instance as any)[camelProp] = value;
    }
  }

  // Apply dynamic bindings directly to the component instance
  if (attrsOpcodes && values) {
    for (let i = 0; i < attrsOpcodes.length; i++) {
      const attrOp = attrsOpcodes[i];
      if (attrOp.name) {
        const rawVal = attrOp.index < values.length ? values[attrOp.index] : undefined;
        if (attrOp.type === 'prop-attr') {
          const resolved = resolveDirectiveValue(rawVal, { type: 3, name: attrOp.name });
          defineElementProperty(instance, attrOp.name, resolved);
          const camelProp = attrOp.name.replace(/-([a-z])/g, (_, g) => g.toUpperCase());
          if (camelProp !== attrOp.name) {
            defineElementProperty(instance, camelProp, resolved);
          }
        } else if (attrOp.type === 'boolean-attr') {
          const resolved = resolveDirectiveValue(rawVal, { type: 4, name: attrOp.name });
          const boolVal = Boolean(resolved);
          defineElementProperty(instance, attrOp.name, boolVal);
          const camelProp = attrOp.name.replace(/-([a-z])/g, (_, g) => g.toUpperCase());
          if (camelProp !== attrOp.name) {
            defineElementProperty(instance, camelProp, boolVal);
          }
          if (boolVal && typeof instance.setAttribute === 'function') {
            instance.setAttribute(attrOp.name, '');
          }
        } else if (attrOp.type === 'attr') {
          const resolved = resolveDirectiveValue(rawVal, { type: 1, name: attrOp.name });
          if (!isNothing(resolved) && resolved !== undefined && resolved !== null) {
            const strVal = String(resolved);
            if (typeof instance.setAttribute === 'function') {
              instance.setAttribute(attrOp.name, strVal);
            }
            const camelProp = attrOp.name.replace(/-([a-z])/g, (_, g) => g.toUpperCase());
            if (camelProp in instance && typeof (instance as any)[camelProp] !== 'function') {
              (instance as any)[camelProp] = resolved;
            }
          }
        }
      }
    }
  }

  // Push slot projection context
  const slotCtx = slotManager.pushContext(tagName);
  context.depth++;
  try {
    // Parse inner HTML into slotted nodes preserving mixed text nodes when in flattened mode
    if (context.mode === 'flattened') {
      const slottedNodes = getParsedSlottedNodes(innerHtml);
      for (let i = 0; i < slottedNodes.length; i++) {
        slotCtx.addNode(slottedNodes[i]);
      }
    }

    // Lifecycle calls
    try {
      instance.connectedCallback?.();
    } catch {
      // In SSR, ignore client-side DOM attachment errors during connectedCallback
    }
    instance.willUpdate?.(new Map());

    // Extract component styles
    const { local: localStyles } = context.compilerBridge.extractComponentStyles(Ctor);

    // Render shadow template
    const shadowResult = instance.render?.();

    if (context.mode === 'dsd') {
      yield `<${tagName}${attrsStr}>`;
      yield '<template shadowrootmode="open">';
      if (localStyles.length > 0) {
        yield `<style>${localStyles.join('\n')}</style>`;
      }
      if (shadowResult) {
        yield* renderInternal(shadowResult, context, maxDepth, slotManager);
      }
      yield '</template>';

      // Recursively expand custom elements in light DOM children if not already expanded
      if (innerHtml.length > 0) {
        if (isAlreadyExpanded) {
          yield innerHtml;
        } else {
          yield* processStaticHtmlChunk(innerHtml, context, maxDepth, slotManager);
        }
      }

      // Resumable state snapshot
      if (context.resumable) {
        const stateScript = context.compilerBridge.serializeComponentState(instance, context);
        if (stateScript) {
          yield stateScript;
        }
      }

      yield `</${tagName}>`;
    } else {
      // Flattened mode: Render shadow root with projected slots, omit shadow boundary
      yield `<${tagName}${attrsStr}>`;
      if (shadowResult) {
        yield* renderInternal(shadowResult, context, maxDepth, slotManager);
      }
      yield `</${tagName}>`;
    }
  } finally {
    context.depth--;
    slotManager.popContext();
  }
}

function* renderComponentInstance(instance: any, context: SsrRenderContext, maxDepth: number, slotManager: SlotManager): IterableIterator<string> {
  const ctor = instance.constructor;
  const tagName = (instance.tagName ? instance.tagName.toLowerCase() : ctor.is || 'custom-element').toLowerCase();

  defineElementProperty(instance, 'isConnected', true);
  if (typeof instance.enableUpdating === 'function') {
    defineElementProperty(instance, 'enableUpdating', () => {});
  }
  try {
    instance.connectedCallback?.();
  } catch {
    // In SSR, ignore client-side DOM attachment errors during connectedCallback
  }
  instance.willUpdate?.(new Map());

  const { local: localStyles } = context.compilerBridge.extractComponentStyles(ctor);
  const shadowResult = instance.render?.();

  slotManager.pushContext(tagName);
  try {
    if (context.mode === 'dsd') {
      yield `<${tagName}>`;
      yield '<template shadowrootmode="open">';
      if (localStyles.length > 0) {
        yield `<style>${localStyles.join('\n')}</style>`;
      }
      if (shadowResult) {
        yield* renderInternal(shadowResult, context, maxDepth, slotManager);
      }
      yield '</template>';

      if (context.resumable) {
        const stateScript = context.compilerBridge.serializeComponentState(instance, context);
        if (stateScript) {
          yield stateScript;
        }
      }

      yield `</${tagName}>`;
    } else {
      yield `<${tagName}>`;
      if (shadowResult) {
        yield* renderInternal(shadowResult, context, maxDepth, slotManager);
      }
      yield `</${tagName}>`;
    }
  } finally {
    slotManager.popContext();
  }
}

function* renderComponentDescriptor(
  desc: {
    tagName: string;
    shadowHtml?: string;
    styles?: string | string[];
    attributes?: Record<string, any>;
    lightDom?: string | Array<string | { slot?: string; content: string }>;
    state?: Record<string, unknown> | null;
    domPaths?: boolean;
  },
  context: SsrRenderContext,
  _maxDepth: number,
  slotManager: SlotManager,
): IterableIterator<string> {
  const tag = String(desc.tagName).toLowerCase();
  const attrMap = { ...(desc.attributes || {}) };

  if (context.domPaths || desc.domPaths) {
    attrMap['data-lit-paths'] = 'true';
  }

  // Format host attributes with attribute name sanitization
  let attrStr = '';
  for (const [k, v] of Object.entries(attrMap)) {
    if (!/^[a-zA-Z_:][a-zA-Z0-9_:.-]*$/.test(k)) {
      continue;
    }
    if (v === true) {
      attrStr += ` ${k}`;
    } else if (v !== false && v !== null && v !== undefined) {
      attrStr += ` ${k}="${escapeAttribute(String(v))}"`;
    }
  }

  // Format styles
  let styleTag = '';
  if (desc.styles) {
    const cssContent = Array.isArray(desc.styles) ? desc.styles.join('\n') : String(desc.styles);
    if (cssContent.trim()) {
      styleTag = `<style>${cssContent.trim()}</style>`;
    }
  }

  // Handle slot projection
  let shadowContent = desc.shadowHtml ?? '';
  let lightDomOutput = '';

  const slotCtx = slotManager.pushContext(tag);
  try {
    if (Array.isArray(desc.lightDom)) {
      const normalizedChildren = desc.lightDom.map((child: any) => {
        if (typeof child === 'object' && child !== null && 'content' in child) {
          return child;
        }
        return { slot: undefined, content: String(child) };
      });

      for (const child of normalizedChildren) {
        slotCtx.addNode({
          slotName: child.slot ?? '',
          content: child.content,
        });
      }

      const { projectedShadow, lightRemainder } = projectSlots(shadowContent, normalizedChildren);
      shadowContent = projectedShadow;
      lightDomOutput = lightRemainder;
    } else if (typeof desc.lightDom === 'string') {
      lightDomOutput = desc.lightDom;
    }

    let stateScript = '';
    const stateData = desc.state ?? context.state;
    if (context.resumable && stateData && Object.keys(stateData).length > 0) {
      try {
        const seen = new WeakSet<object>();
        const serialized = JSON.stringify(stateData, (_key, val) => {
          if (typeof val === 'object' && val !== null) {
            if (seen.has(val)) {
              return undefined;
            }
            seen.add(val);
          }
          return val;
        });
        if (serialized && serialized !== '{}') {
          stateScript = `<script type="lit/state">${serialized.replace(/</g, '\\u003c')}</script>`;
        }
      } catch {
        // Suppress circular or unstringifiable state
      }
    }

    if (context.mode === 'dsd') {
      yield `<${tag}${attrStr}>`;
      yield '<template shadowrootmode="open">';
      if (styleTag) yield styleTag;
      if (shadowContent) yield escapeUnclosedTemplateTags(shadowContent);
      yield '</template>';
      if (lightDomOutput) yield lightDomOutput;
      if (stateScript) yield stateScript;
      yield `</${tag}>`;
    } else {
      yield `<${tag}${attrStr}>`;
      if (shadowContent) yield shadowContent;
      if (lightDomOutput) yield lightDomOutput;
      yield `</${tag}>`;
    }
  } finally {
    slotManager.popContext();
  }
}

export function renderToString(value: unknown, options?: RenderOptions): string {
  let result = '';
  for (const chunk of render(value, options)) {
    result += chunk;
  }
  return result;
}

export async function collectResult(result: Iterable<string> | AsyncIterable<string> | ReadableStream<Uint8Array>): Promise<string> {
  // 1. WHATWG ReadableStream
  if (result && typeof (result as any).getReader === 'function') {
    const reader = (result as ReadableStream<Uint8Array>).getReader();
    const decoder = new TextDecoder();
    let accumulated = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        accumulated += decoder.decode(value, { stream: true });
      }
    }
    accumulated += decoder.decode();
    return accumulated;
  }

  // 2. AsyncIterable
  if (result && typeof (result as any)[Symbol.asyncIterator] === 'function') {
    let accumulated = '';
    for await (const chunk of result as AsyncIterable<string>) {
      accumulated += chunk;
    }
    return accumulated;
  }

  // 3. Synchronous Iterable
  if (result && typeof (result as any)[Symbol.iterator] === 'function') {
    let accumulated = '';
    for (const chunk of result as Iterable<string>) {
      accumulated += chunk;
    }
    return accumulated;
  }

  return '';
}
