import { createAsyncBoundary, isAsyncBoundaryDescriptor, isAsyncIterable, isThenable } from './boundary-descriptors.js';
import { isStandardTemplateResult } from './plan-types.js';
import { isNothing, LIT_NO_CHANGE, LIT_NOTHING } from './sentinels.js';
import { createTrustedRawHtml, isTrustedRawHtml } from './trusted-html.js';

export function getPrototypeDepthAboveObject(ctor: { prototype?: object | null }): number {
  let depth = 0;
  let proto = ctor.prototype ?? null;
  while (proto && proto !== Object.prototype) {
    depth++;
    proto = Object.getPrototypeOf(proto);
  }
  return depth;
}

export async function consumeAsyncIterableDirective(iterable: AsyncIterable<unknown>, mapper: unknown, accumulateAll: boolean): Promise<unknown> {
  const mapFn = typeof mapper === 'function' ? (mapper as (v: unknown, index: number) => unknown) : null;
  if (accumulateAll) {
    const items: unknown[] = [];
    let index = 0;
    for await (const raw of iterable) {
      items.push(mapFn ? mapFn(raw, index) : raw);
      index++;
    }
    return items;
  }

  let hasValue = false;
  let lastValue: unknown = LIT_NOTHING;
  let index = 0;
  for await (const raw of iterable) {
    hasValue = true;
    lastValue = mapFn ? mapFn(raw, index) : raw;
    index++;
  }
  return hasValue ? lastValue : LIT_NOTHING;
}

export function resolveDirectiveValue(value: unknown, partInfo: { type: number; name?: string; tagName?: string; strings?: readonly string[] } = { type: 2 }): unknown {
  if (value === null || typeof value !== 'object') {
    return value;
  }

  if (isAsyncBoundaryDescriptor(value) || isTrustedRawHtml(value)) {
    return value;
  }

  const directiveCtor = (value as any)._$litDirective$;
  if (typeof directiveCtor === 'function') {
    const args: unknown[] = Array.isArray((value as any).values) ? (value as any).values : [];
    let directiveInstance: any = null;
    try {
      directiveInstance = new directiveCtor(partInfo);
    } catch {
      directiveInstance = null;
    }

    let rendered: unknown = value;
    let didRender = false;
    if (directiveInstance && typeof directiveInstance.render === 'function') {
      rendered = directiveInstance.render(...args);
      didRender = true;
    } else if (typeof directiveCtor.prototype?.render === 'function') {
      rendered = directiveCtor.prototype.render.apply({ _$part: partInfo }, args);
      didRender = true;
    }

    if (didRender) {
      // Detect Lit's unsafeHTML / unsafeSVG / unsafeMathML directive results without relying on
      // class names (minification-safe): ECMAScript tagged template literals always freeze
      // TemplateStringsArray, whereas UnsafeHTMLDirective wraps its raw string argument into a
      // synthetic unfrozen 1-element strings array with zero dynamic values.
      if (
        partInfo.type === 2 &&
        args.length >= 1 &&
        typeof args[0] === 'string' &&
        isStandardTemplateResult(rendered) &&
        rendered.values.length === 0 &&
        rendered.strings.length === 1 &&
        rendered.strings[0] === args[0] &&
        !Object.isFrozen(rendered.strings)
      ) {
        return createTrustedRawHtml(args[0]);
      }

      // Detect asyncAppend / asyncReplace directives: render() returns noChange while args[0]
      // is an AsyncIterable. AsyncAppendDirective subclasses AsyncReplaceDirective -> AsyncDirective -> Directive
      // (depth >= 4 above Object.prototype), whereas AsyncReplaceDirective has depth 3.
      if (partInfo.type === 2 && (rendered === LIT_NO_CHANGE || isNothing(rendered)) && args.length >= 1 && isAsyncIterable(args[0])) {
        const protoDepth = getPrototypeDepthAboveObject(directiveCtor);
        const accumulateAll = protoDepth >= 4;
        return createAsyncBoundary(consumeAsyncIterableDirective(args[0], args[1], accumulateAll), LIT_NOTHING);
      }

      // If a child-part directive (such as lit/directives/until.js) received a higher-priority
      // Promise argument before its synchronous fallback, pair the Promise and fallback into
      // an SsrAsyncBoundaryDescriptor without relying on directive class names (minification-safe).
      if (partInfo.type === 2 && !isThenable(rendered) && !isAsyncBoundaryDescriptor(rendered) && args.length > 0) {
        let firstThenable: PromiseLike<unknown> | null = null;
        for (let i = 0; i < args.length; i++) {
          const arg = args[i];
          if (arg === rendered) {
            break;
          }
          if (isThenable(arg)) {
            firstThenable = arg;
            break;
          }
        }
        if (firstThenable) {
          return createAsyncBoundary(firstThenable, rendered);
        }
      }
      if (rendered !== null && typeof rendered === 'object' && rendered !== value && typeof (rendered as any)._$litDirective$ === 'function') {
        return resolveDirectiveValue(rendered, partInfo);
      }
      return rendered;
    }
  }

  return value;
}
