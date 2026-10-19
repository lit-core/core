/**
 * Compiler integration bridge for @lit-core/ssr.
 * Bridges @lit-core/html-aot, @lit-core/css-fuse, @lit-core/directives,
 * and @lit-core/resumable. This module is part of the runtime entry and must stay
 * free of Node-only imports (node:*, native addons) so it loads on any JS runtime.
 */

import { extractComponentState as resumableExtractComponentState, renderStateScript as resumableRenderStateScript } from '@lit-core/resumable/server';
import type { CustomElementRegistryLike } from './environment.js';

export const LIT_NOTHING = Symbol.for('lit-nothing');
export const LIT_NO_CHANGE = Symbol.for('lit-noChange');

export function isNothing(val: unknown): boolean {
  if (val === LIT_NOTHING || val === LIT_NO_CHANGE) return true;
  if (typeof val === 'symbol') {
    const desc = val.description;
    return desc === 'lit-nothing' || desc === 'lit-noChange';
  }
  return false;
}

export interface CompiledTemplatePart {
  type: number;
  index: number;
  name?: string;
  strings?: string[];
  ctor?: unknown;
  ctorType?: number;
}

export interface CompiledTemplateDescriptor {
  h: TemplateStringsArray | string[] | string;
  parts: CompiledTemplatePart[];
}

export interface CompiledTemplateResult {
  _$litType$: CompiledTemplateDescriptor;
  values: unknown[];
}

export interface SsrRenderContext {
  depth: number;
  resumable: boolean;
  domPaths: boolean;
  cssFuse: boolean;
  mode: 'dsd' | 'flattened';
  customElements?: CustomElementRegistryLike;
  state?: Record<string, unknown>;
  styleDeduplicator: StyleDeduplicator;
  compilerBridge: CompilerBridge;
  renderValue: (val: unknown, ctx: SsrRenderContext) => Iterable<string>;
}

export function isCompiledTemplateResult(value: unknown): value is CompiledTemplateResult {
  if (value === null || typeof value !== 'object') return false;
  const litType = (value as any)._$litType$;
  return litType !== null && typeof litType === 'object' && 'h' in litType && (!('parts' in litType) || litType.parts == null || Array.isArray(litType.parts)) && Array.isArray((value as any).values);
}

export function isStandardTemplateResult(value: unknown): value is { strings: TemplateStringsArray; values: unknown[]; _$litType$?: unknown } {
  if (value === null || typeof value !== 'object') return false;
  const litType = (value as any)._$litType$;
  return (typeof litType === 'number' || typeof litType === 'string' || typeof litType === 'undefined') && Array.isArray((value as any).strings) && Array.isArray((value as any).values);
}

export function resolveDirectiveValue(value: unknown, partInfo: { type: number; name?: string; tagName?: string } = { type: 2 }): unknown {
  if (value === null || typeof value !== 'object') {
    return value;
  }

  const directiveCtor = (value as any)._$litDirective$;
  if (typeof directiveCtor === 'function') {
    const args = Array.isArray((value as any).values) ? (value as any).values : [];
    try {
      const directiveInstance = new directiveCtor(partInfo);
      return directiveInstance.render(...args);
    } catch {
      if (typeof directiveCtor.prototype?.render === 'function') {
        return directiveCtor.prototype.render.apply({ _$part: partInfo }, args);
      }
    }
  }

  return value;
}

export function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function escapeAttribute(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export interface ExtractedStyles {
  sharedSheets: string[];
  localStyles: string[];
  sharedEntries?: Array<{ key: string; css: string }>;
}

export class StyleDeduplicator {
  private readonly seenSharedSheets = new Set<string>();
  private readonly collectedStyles: string[] = [];
  private static ctorStyleCache = new WeakMap<any, ExtractedStyles>();

  public static resetCache(): void {
    StyleDeduplicator.ctorStyleCache = new WeakMap<any, ExtractedStyles>();
  }

  public processComponentStyles(ctor: any): ExtractedStyles {
    if (ctor) {
      const cached = StyleDeduplicator.ctorStyleCache.get(ctor);
      if (cached) {
        if (cached.sharedEntries) {
          for (const entry of cached.sharedEntries) {
            if (!this.seenSharedSheets.has(entry.key)) {
              this.seenSharedSheets.add(entry.key);
              this.collectedStyles.push(entry.css);
            }
          }
        }
        return cached;
      }
    }

    const rawStyles = ctor?.styles;
    if (!rawStyles) {
      const empty = { sharedSheets: [], localStyles: [], sharedEntries: [] };
      if (ctor) StyleDeduplicator.ctorStyleCache.set(ctor, empty);
      return empty;
    }

    const flatStyles = Array.isArray(rawStyles) ? rawStyles.flat(Infinity) : [rawStyles];
    const shared: string[] = [];
    const local: string[] = [];
    const sharedEntries: Array<{ key: string; css: string }> = [];

    for (const item of flatStyles) {
      if (!item) continue;
      const cssText = typeof item === 'string' ? item : (item.cssText ?? String(item));
      const trimmed = cssText.trim();
      if (!trimmed) continue;

      const isFused = Boolean((item as any)._fusedId || (item as any)._fused || trimmed.includes('/* @lit-core/css-fuse */'));
      const sheetKey = (item as any)._fusedId || this.hashCss(trimmed);

      if (isFused || this.isSharedCandidate(trimmed)) {
        if (!this.seenSharedSheets.has(sheetKey)) {
          this.seenSharedSheets.add(sheetKey);
          this.collectedStyles.push(trimmed);
        }
        shared.push(trimmed);
        sharedEntries.push({ key: sheetKey, css: trimmed });
      } else {
        local.push(trimmed);
      }
    }

    const result = { sharedSheets: shared, localStyles: local, sharedEntries };
    if (ctor) StyleDeduplicator.ctorStyleCache.set(ctor, result);
    return result;
  }

  public getCollectedStyles(): string[] {
    return [...this.collectedStyles];
  }

  private hashCss(css: string): string {
    let hash = 5381;
    for (let i = 0; i < css.length; i++) {
      hash = (hash * 33) ^ css.charCodeAt(i);
    }
    return (hash >>> 0).toString(16);
  }

  private isSharedCandidate(css: string): boolean {
    return css.length > 256;
  }
}

type ChunkSegment = string | ((values: unknown[], context: SsrRenderContext) => Iterable<string>);

export class PreparedChunkPlan {
  readonly segments: ChunkSegment[] = [];

  constructor(descriptor: CompiledTemplateDescriptor) {
    this.build(descriptor);
  }

  private build(descriptor: CompiledTemplateDescriptor): void {
    const htmlText = descriptor?.h ? (typeof descriptor.h === 'string' ? descriptor.h : Array.isArray(descriptor.h) ? ((descriptor.h as any)[0] ?? '') : String(descriptor.h)) : '';

    const parts = Array.isArray(descriptor?.parts) ? descriptor.parts : [];
    const len = htmlText.length;
    let i = 0;
    let nodeIndex = -1;
    let textStart = 0;

    // Group attribute parts by their element node index
    const attrPartsByElement = new Map<number, { part: CompiledTemplatePart; partIndex: number }[]>();
    // Map child parts by their child node index (supports multiple parts per index)
    const childPartsByIndex = new Map<number, { part: CompiledTemplatePart; partIndex: number }[]>();

    for (let pIdx = 0; pIdx < parts.length; pIdx++) {
      const p = parts[pIdx];
      if (p.type === 1) {
        let list = attrPartsByElement.get(p.index);
        if (!list) {
          list = [];
          attrPartsByElement.set(p.index, list);
        }
        list.push({ part: p, partIndex: pIdx });
      } else if (p.type === 2) {
        let list = childPartsByIndex.get(p.index);
        if (!list) {
          list = [];
          childPartsByIndex.set(p.index, list);
        }
        list.push({ part: p, partIndex: pIdx });
      }
    }

    let childPartCounter = 0;
    const consumedChildPartIndices = new Set<number>();
    const childPartsInOrder = parts.map((p, idx) => ({ part: p, partIndex: idx })).filter((item) => item.part.type === 2);

    while (i < len) {
      // Check for <?> child part placeholder
      if (i + 2 < len && htmlText[i] === '<' && htmlText[i + 1] === '?' && htmlText[i + 2] === '>') {
        nodeIndex++;
        if (i > textStart) {
          this.segments.push(htmlText.slice(textStart, i));
        }

        let childInfo: { part: CompiledTemplatePart; partIndex: number } | undefined;
        const indexList = childPartsByIndex.get(nodeIndex);
        if (indexList && indexList.length > 0) {
          for (const candidate of indexList) {
            if (!consumedChildPartIndices.has(candidate.partIndex)) {
              childInfo = candidate;
              break;
            }
          }
        }

        if (!childInfo) {
          while (childPartCounter < childPartsInOrder.length && consumedChildPartIndices.has(childPartsInOrder[childPartCounter].partIndex)) {
            childPartCounter++;
          }
          if (childPartCounter < childPartsInOrder.length) {
            childInfo = childPartsInOrder[childPartCounter++];
          }
        }

        if (childInfo) {
          consumedChildPartIndices.add(childInfo.partIndex);
          while (childPartCounter < childPartsInOrder.length && consumedChildPartIndices.has(childPartsInOrder[childPartCounter].partIndex)) {
            childPartCounter++;
          }

          const valIdx = childInfo.partIndex;
          this.segments.push(function* (values, ctx) {
            if (valIdx < values.length) {
              const rawVal = values[valIdx];
              const resolved = resolveDirectiveValue(rawVal, { type: 2 });
              yield* ctx.renderValue(resolved, ctx);
            }
          });
        }

        i += 3;
        textStart = i;
        continue;
      }

      // Check for comment <!--
      if (i + 3 < len && htmlText[i] === '<' && htmlText[i + 1] === '!' && htmlText[i + 2] === '-' && htmlText[i + 3] === '-') {
        nodeIndex++;
        i += 4;
        continue;
      }

      // Check for start tag <tag
      if (htmlText[i] === '<' && i + 1 < len && /[a-zA-Z_]/.test(htmlText[i + 1])) {
        nodeIndex++;
        const currentElemIndex = nodeIndex;
        const attrs = attrPartsByElement.get(currentElemIndex);

        if (attrs && attrs.length > 0) {
          // Scan ahead to find end of opening tag >
          let tagEnd = i + 1;
          let inQuote: string | null = null;
          while (tagEnd < len) {
            const ch = htmlText[tagEnd];
            if (inQuote) {
              if (ch === inQuote) inQuote = null;
            } else {
              if (ch === '"' || ch === "'") {
                inQuote = ch;
              } else if (ch === '>') {
                break;
              }
            }
            tagEnd++;
          }

          if (tagEnd < len) {
            const isSelfClosing = htmlText[tagEnd - 1] === '/';
            const insertPoint = isSelfClosing ? tagEnd - 1 : tagEnd;

            if (insertPoint > textStart) {
              this.segments.push(htmlText.slice(textStart, insertPoint));
            }

            // Create attribute emitter callback
            const attrsToEmit = [...attrs];
            this.segments.push(function* (values, ctx) {
              for (const { part, partIndex } of attrsToEmit) {
                const val = partIndex < values.length ? values[partIndex] : undefined;
                const resolved = resolveDirectiveValue(val, {
                  type: 1,
                  name: part.name,
                });

                if (isNothing(resolved) || resolved === null || resolved === undefined) {
                  continue;
                }

                const ctorType = part.ctorType ?? (part.name?.startsWith('?') ? 4 : part.name?.startsWith('@') ? 5 : part.name?.startsWith('.') ? 3 : 1);
                const attrName = part.name ?? '';

                if (ctorType === 4) {
                  // Boolean attribute (?attr)
                  if (resolved) {
                    yield ` ${attrName}`;
                  }
                } else if (ctorType === 5) {
                  // Event attribute (@event)
                  if (ctx.resumable) {
                    yield ` resumes-on-${attrName}`;
                  }
                } else if (ctorType === 3) {
                  // Property binding (.prop) - excluded from HTML attributes
                } else {
                  // Standard attribute
                  let formatted: string;
                  if (part.strings && part.strings.length > 1) {
                    formatted = part.strings[0] + String(resolved) + part.strings.slice(1).join('');
                  } else {
                    formatted = String(resolved);
                  }
                  yield ` ${attrName}="${escapeAttribute(formatted)}"`;
                }
              }
            });

            if (isSelfClosing) {
              this.segments.push('/>');
              i = tagEnd + 1;
            } else {
              this.segments.push('>');
              i = tagEnd + 1;
            }
            textStart = i;
            continue;
          }
        }
      }

      i++;
    }

    if (textStart < len) {
      this.segments.push(htmlText.slice(textStart, len));
    }
  }

  *execute(values: unknown[], context: SsrRenderContext): IterableIterator<string> {
    for (const seg of this.segments) {
      if (typeof seg === 'string') {
        yield seg;
      } else {
        yield* seg(values, context);
      }
    }
  }
}

export class CompilerBridge {
  private static readonly chunkPlanCache = new WeakMap<CompiledTemplateDescriptor, PreparedChunkPlan>();
  readonly styleDeduplicator = new StyleDeduplicator();

  public isCompiled(value: unknown): value is CompiledTemplateResult {
    return isCompiledTemplateResult(value);
  }

  public getOrCreateChunkPlan(descriptor: CompiledTemplateDescriptor): PreparedChunkPlan {
    let plan = CompilerBridge.chunkPlanCache.get(descriptor);
    if (!plan) {
      plan = new PreparedChunkPlan(descriptor);
      CompilerBridge.chunkPlanCache.set(descriptor, plan);
    }
    return plan;
  }

  public *renderCompiledTemplate(result: CompiledTemplateResult, context: SsrRenderContext): IterableIterator<string> {
    const plan = this.getOrCreateChunkPlan(result._$litType$);
    yield* plan.execute(result.values, context);
  }

  public extractComponentStyles(ctor: any): { shared: string[]; local: string[] } {
    const res = this.styleDeduplicator.processComponentStyles(ctor);
    return { shared: res.sharedSheets, local: res.localStyles };
  }

  public serializeComponentState(component: any, context: SsrRenderContext): string {
    if (!context.resumable) return '';
    try {
      const stateObj = resumableExtractComponentState(component);
      if (stateObj && Object.keys(stateObj).length > 0) {
        return resumableRenderStateScript(stateObj);
      }
    } catch {
      // Fallback if component is a raw object or has instance state
      if (context.state && Object.keys(context.state).length > 0) {
        try {
          return resumableRenderStateScript(context.state);
        } catch {
          return '';
        }
      }
    }
    return '';
  }
}
