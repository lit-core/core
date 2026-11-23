import { isAsyncBoundaryDescriptor, isCompiledTemplateResult, isNothing, isStandardTemplateResult, isThenable, isTrustedRawHtml, type SsrOpcode, type SsrRenderContext } from './compiler-bridge.js';
import { isElementInstance } from './element-utils.js';
import type { CustomElementLookup } from './environment.js';
import { hasExistingDeclarativeShadowRoot } from './opcode-helpers.js';
import { resolveCompiledPlan, resolveStandardPlan } from './plan-cache.js';
import type { RenderOptions } from './render-options.js';
import { findMatchingCloseTag } from './slot.js';

export function createContextLookup(contextOption?: Map<unknown, unknown> | Record<PropertyKey, unknown>): ((key: unknown) => { found: boolean; value: unknown }) | undefined {
  if (!contextOption) return undefined;
  if (contextOption instanceof Map) {
    return (key: unknown) => {
      if (contextOption.has(key)) {
        return { found: true, value: contextOption.get(key) };
      }
      return { found: false, value: undefined };
    };
  }
  return (key: unknown) => {
    if ((typeof key === 'string' || typeof key === 'symbol' || typeof key === 'number') && Object.hasOwn(contextOption, key)) {
      return { found: true, value: (contextOption as Record<PropertyKey, unknown>)[key] };
    }
    return { found: false, value: undefined };
  };
}

export function isElementExcluded(tagName: string, exclude?: RenderOptions['excludeElements']): boolean {
  if (!exclude) return false;
  if (typeof exclude === 'function') return exclude(tagName);
  if (exclude instanceof Set) return exclude.has(tagName);
  if (Array.isArray(exclude)) return exclude.includes(tagName);
  return false;
}

export function componentHasShadowRoot(instance: any, Ctor: any): boolean {
  if (instance?.renderRoot === instance) {
    return false;
  }
  return Boolean(typeof instance?.render === 'function' || instance?.shadowRoot || instance?.__shadowRoot || Ctor?._$litElement$ || Ctor?.styles || Ctor?.elementStyles);
}

/** The optional members a render value may carry; each is checked before use. */
interface RenderValueShape {
  [Symbol.asyncIterator]?: unknown;
  [Symbol.iterator]?: unknown;
  _$litDirective$?: unknown;
  _$litType$?: { ssrPlan?: any };
  values?: unknown;
}

function valuesOf(shape: RenderValueShape): unknown[] {
  return Array.isArray(shape.values) ? shape.values : [];
}

/** The binding values of a template result, whichever flavor it is. */
export function templateValuesOf(template: object): unknown[] {
  return valuesOf(template as RenderValueShape);
}

/** Render mode 1 marks a template as server-only, so nothing in it needs hydration markers. */
export function isHydratableTemplate(template: object): boolean {
  return (template as { _$litServerRenderMode?: unknown })._$litServerRenderMode !== 1;
}

export function shadowMayContainAsyncBoundary(value: unknown, context: SsrRenderContext, depth = 0): boolean {
  if (depth > 32 || value === null || value === undefined || typeof value !== 'object') {
    return false;
  }
  if (isNothing(value) || isTrustedRawHtml(value)) {
    return false;
  }
  if (isThenable(value) || isAsyncBoundaryDescriptor(value)) {
    return true;
  }
  const shape = value as RenderValueShape;
  if (typeof shape[Symbol.asyncIterator] === 'function') {
    return true;
  }
  if (isElementInstance(value)) {
    return true;
  }
  if (typeof shape._$litDirective$ === 'function') {
    for (const arg of valuesOf(shape)) {
      if (typeof arg === 'function' || shadowMayContainAsyncBoundary(arg, context, depth + 1)) {
        return true;
      }
    }
    return false;
  }
  if (isCompiledTemplateResult(value)) {
    const plan = resolveCompiledPlan(value, !context.edge);
    if (plan?.v !== 2) {
      return true;
    }
    if (hasExpandableCustomElement(plan.opcodes, context.customElements, context.excludeElements)) {
      return true;
    }
    for (const item of value.values) {
      if (shadowMayContainAsyncBoundary(item, context, depth + 1)) {
        return true;
      }
    }
    return false;
  }
  if (isStandardTemplateResult(value)) {
    const plan = resolveStandardPlan(value, !context.edge);
    if (plan?.v !== 2) {
      return true;
    }
    if (hasExpandableCustomElement(plan.opcodes, context.customElements, context.excludeElements)) {
      return true;
    }
    for (const item of valuesOf(shape)) {
      if (shadowMayContainAsyncBoundary(item, context, depth + 1)) {
        return true;
      }
    }
    return false;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      if (shadowMayContainAsyncBoundary(item, context, depth + 1)) {
        return true;
      }
    }
    return false;
  }
  if (Symbol.iterator in value && typeof shape[Symbol.iterator] === 'function') {
    return true;
  }
  return false;
}

export function hasExpandableCustomElement(opcodes: SsrOpcode[], registry?: CustomElementLookup, exclude?: RenderOptions['excludeElements']): boolean {
  if (!registry) return false;
  for (let i = 0; i < opcodes.length; i++) {
    const op = opcodes[i];
    if (op.type === 'open' && op.isCustomElement && !isElementExcluded(op.tag.toLowerCase(), exclude) && registry.get(op.tag)) {
      const closeTagIndex = findMatchingCloseTag(opcodes, i, opcodes.length);
      const childStart = i + 1;
      const childEnd = op.isVoid || op.isSelfClosing || closeTagIndex === i ? i + 1 : closeTagIndex;
      if (!hasExistingDeclarativeShadowRoot(opcodes, childStart, childEnd)) {
        return true;
      }
    }
  }
  return false;
}
