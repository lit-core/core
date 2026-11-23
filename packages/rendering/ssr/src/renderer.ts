import {
  CompilerBridge,
  escapeHtml,
  isAsyncBoundaryDescriptor,
  isCompiledTemplateResult,
  isNothing,
  isStandardTemplateResult,
  isThenable,
  isTrustedRawHtml,
  resolveDirectiveValue,
  type SsrAsyncRenderState,
  type SsrDynamicAttribute,
  type SsrOpcode,
  type SsrRenderContext,
} from './compiler-bridge.js';
import { getCtorSsrMeta, repairShadowedClassFields } from './component/ctor-meta.js';
import { readLiveHostAttributesMap, serializeHostAttributeString } from './component/host-attributes.js';
import { hasNoLifecycleExtensions, prepareAndRunComponentLifecycle, prepareComponentBindings } from './component/lifecycle.js';
import { type CompiledDsdStep, compileDsdSteps } from './dsd-steps.js';
import { isElementInstance } from './element-utils.js';
import { type CustomElementLookup, HTMLElementStub, IsolateCustomElementRegistry } from './environment.js';
import { hasExistingDeclarativeShadowRoot, renderStaticAttrsToString } from './opcode-helpers.js';
import { resolveCompiledPlan, resolveStandardPlan } from './plan-cache.js';
import { renderDynamicAttrsToString } from './render-attributes.js';
import { EMPTY_EVENT_ATTRS, SHARED_DSD_SLOT_MANAGER, SHARED_STATELESS_COMPILER_BRIDGE } from './render-constants.js';
import { componentHasShadowRoot, createContextLookup, isElementExcluded, isHydratableTemplate, shadowMayContainAsyncBoundary, templateValuesOf } from './render-guards.js';
import type { RenderOptions } from './render-options.js';
import { formatAdoptedUrlFallbackScript, formatCssAdoptScript } from './sdsd-scripts.js';
import { buildShadowStyleAndTemplateOpen, isClientHydratableLitHost, isServerElementClassOrInstance, SERVER_ELEMENT_SYMBOL } from './shadow-template.js';
import { distributeHostChildren, findMatchingCloseTag, SlotManager } from './slot.js';
import { isValidTagName } from './validation.js';

export function createSsrRenderContext(options: RenderOptions = {}, asyncState?: SsrAsyncRenderState): { context: SsrRenderContext; maxDepth: number; slotManager: SlotManager } {
  const registry: CustomElementLookup = options.customElements ?? (globalThis as any).customElements ?? new IsolateCustomElementRegistry();
  const mode = options.mode ?? 'dsd';
  const resumable = options.resumable ?? true;
  const cssFuse = options.cssFuse ?? true;
  const slotManager = mode === 'dsd' ? SHARED_DSD_SLOT_MANAGER : new SlotManager();
  const compilerBridge = !cssFuse && !resumable && !options.adoptedStyleSheets ? SHARED_STATELESS_COMPILER_BRIDGE : new CompilerBridge();
  const maxDepth = options.depth ?? 100;

  const context: SsrRenderContext = {
    depth: 0,
    resumable,
    domPaths: Boolean(options.domPaths),
    cssFuse,
    mode,
    customElements: registry,
    state: options.state,
    styleDeduplicator: compilerBridge.styleDeduplicator,
    compilerBridge,
    renderValue: (val, ctx) => renderInternal(val, ctx, maxDepth, slotManager),
    parentHost: null,
    contextLookup: createContextLookup(options.context),
    onError: options.onError,
    strictLifecycle: options.strictLifecycle,
    adoptedStyleSheets: options.adoptedStyleSheets,
    asyncState,
    edge: Boolean(options.edge),
    streamingMode: options.streamingMode ?? 'out-of-order',
    nonce: options.nonce,
    deferHydration: Boolean(options.deferHydration),
    litShadowDepth: 0,
    hydratableScope: true,
    customElementRendered: options.customElementRendered,
    excludeElements: options.excludeElements,
    shouldCallConnectedCallback: options.shouldCallConnectedCallback,
    serverElementAdapter: options.serverElementAdapter,
  };

  return { context, maxDepth, slotManager };
}

export function* flushStyleDeduplicationScripts(context: SsrRenderContext): IterableIterator<string> {
  if (context.mode !== 'dsd') return;
  const urlEntries = context.styleDeduplicator.flushAdoptedUrlSheets();
  if (urlEntries.length > 0) {
    yield formatAdoptedUrlFallbackScript(urlEntries, context.nonce);
  }
  const adoptState = context.styleDeduplicator.consumePendingInlineAdoption();
  if (adoptState.needsCall) {
    yield formatCssAdoptScript(adoptState.needsBootstrap, context.nonce);
  }
}

export function* render(value: unknown, options: RenderOptions = {}): IterableIterator<string> {
  const { context, maxDepth, slotManager } = createSsrRenderContext(options);
  yield* renderInternal(value, context, maxDepth, slotManager);
  yield* flushStyleDeduplicationScripts(context);
}

export function* renderInternal(value: unknown, context: SsrRenderContext, maxDepth: number, slotManager: SlotManager): IterableIterator<string> {
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

  // 2a. Unforgeable trusted raw HTML brand (produced exclusively by unsafeHTML / unsafeSVG directives)
  if (isTrustedRawHtml(value)) {
    yield value.html;
    return;
  }

  // 2b. Async boundary descriptor (e.g., lit/directives/until.js, asyncAppend, asyncReplace, or createAsyncBoundary)
  if (isAsyncBoundaryDescriptor(value)) {
    value.promise.catch(() => {});
    if (context.asyncState && context.mode === 'dsd') {
      const boundaryId = context.asyncState.nextBoundaryId++;
      context.asyncState.boundaries.push({
        id: boundaryId,
        shadowPath: [...context.asyncState.shadowPath],
        promise: value.promise,
        errorFallback: value.errorFallback,
        group: value.group,
      });
      yield `<!--$b:${boundaryId}-->`;
      yield* renderInternal(value.fallback, context, maxDepth, slotManager);
      yield `<!--/$b:${boundaryId}-->`;
    } else {
      yield* renderInternal(value.fallback, context, maxDepth, slotManager);
    }
    return;
  }

  // 2c. Direct Promise / Thenable child expression
  if (isThenable(value)) {
    const p = Promise.resolve(value);
    p.catch(() => {});
    if (context.asyncState && context.mode === 'dsd') {
      const boundaryId = context.asyncState.nextBoundaryId++;
      context.asyncState.boundaries.push({
        id: boundaryId,
        shadowPath: [...context.asyncState.shadowPath],
        promise: p,
      });
      yield `<!--$b:${boundaryId}--><!--/$b:${boundaryId}-->`;
    }
    return;
  }

  // 2d. Lit DirectiveResult (including renderLight() and directives inside arrays/iterables)
  if (typeof value === 'object' && value !== null && typeof (value as any)._$litDirective$ === 'function') {
    if ((value as any)._$litDirective$._$litRenderLight === true) {
      const lightOut = typeof (context.parentHost as any)?.renderLight === 'function' ? (context.parentHost as any).renderLight() : undefined;
      if (lightOut !== undefined) {
        yield* renderInternal(lightOut, context, maxDepth, slotManager);
      }
      return;
    }
    const resolved = resolveDirectiveValue(value, { type: 2 });
    yield* renderInternal(resolved, context, maxDepth, slotManager);
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
      !isElementInstance(value))
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
    const plan = resolveCompiledPlan(value, !context.edge);
    if (!plan) {
      throw new Error('[@lit-core/ssr] Uncompiled Lit template encountered in edge mode. Templates must be compiled ahead of time via @lit-core/html-aot or bundler plugins.');
    }
    const prevHydratable = context.hydratableScope;
    context.hydratableScope = isHydratableTemplate(value);
    context.depth++;
    try {
      yield* renderPlanV2Opcodes(plan.opcodes, value.values, context, maxDepth, slotManager);
    } finally {
      context.depth--;
      context.hydratableScope = prevHydratable;
    }
    return;
  }

  // 5. Standard Lit TemplateResult
  if (isStandardTemplateResult(value)) {
    if (context.edge) {
      throw new Error('[@lit-core/ssr] Uncompiled Lit template encountered in edge mode. Templates must be compiled ahead of time via @lit-core/html-aot or bundler plugins.');
    }
    const plan = resolveStandardPlan(value, true);
    const templateValues = templateValuesOf(value);
    const prevHydratable = context.hydratableScope;
    context.hydratableScope = isHydratableTemplate(value);
    context.depth++;
    try {
      yield* renderPlanV2Opcodes(plan.opcodes, templateValues, context, maxDepth, slotManager);
    } finally {
      context.depth--;
      context.hydratableScope = prevHydratable;
    }
    return;
  }

  // 6. Real Custom Element instance (HTMLElementStub or HTMLElement)
  if (isElementInstance(value)) {
    context.depth++;
    try {
      yield* renderComponentInstance(value, context, maxDepth, slotManager);
    } finally {
      context.depth--;
    }
    return;
  }

  // 7. Generic object fallback: always render escaped text (matching Lit client semantics)
  yield escapeHtml(String(value));
}

function* renderCustomElementWithOpcodeChildren(
  tagName: string,
  Ctor: new () => any,
  opcodes: SsrOpcode[],
  values: unknown[],
  start: number,
  end: number,
  context: SsrRenderContext,
  maxDepth: number,
  slotManager: SlotManager,
  staticAttrs?: Record<string, string>,
  dynamicAttrs?: SsrDynamicAttribute[],
): IterableIterator<string> {
  if (context.depth >= maxDepth) {
    throw new RangeError('Maximum SSR render depth exceeded');
  }
  const normalizedTag = tagName.toLowerCase();
  if (!isValidTagName(normalizedTag)) {
    throw new Error(`[@lit-core/ssr] Invalid custom element tag name '${tagName}'.`);
  }

  const instance = new Ctor();
  const isFlattened = context.mode !== 'dsd';
  const slotCtx = isFlattened ? slotManager.pushContext(normalizedTag) : null;
  const prevParentHost = context.parentHost;
  context.depth++;

  try {
    if (slotCtx) {
      distributeHostChildren(opcodes, values, start, end, slotCtx);
    }
    context.customElementRendered?.(normalizedTag);

    if (!isFlattened && context.asyncState && context.streamingMode !== 'in-order' && context.serverElementAdapter?.canHandle(Ctor, normalizedTag)) {
      const { eventAttrs: adapterEventAttrs } = prepareComponentBindings({
        instance,
        Ctor,
        tagName: normalizedTag,
        staticAttrs,
        dynamicAttrs,
        values,
        lightOpcodes: start < end ? { opcodes, values, start, end } : undefined,
        parentHost: prevParentHost,
        contextLookup: context.contextLookup,
        onError: context.onError,
        strictLifecycle: context.strictLifecycle,
        resumable: context.resumable,
      });
      const incomingAttrs = Object.fromEntries(readLiveHostAttributesMap(instance).entries());
      const hostId = context.asyncState.nextHostId++;
      const { templateOpenTag, styleTag, adoptKeys, adoptedUrls } = buildShadowStyleAndTemplateOpen(Ctor, context);
      const prepared = context.serverElementAdapter.prepareBoundary({
        instance,
        Ctor,
        tagName: normalizedTag,
        hostId,
        incomingAttrs,
        ssrContext: context,
      });
      prepared.boundaryPromise.catch(() => {});
      const nestedPath = [...context.asyncState.shadowPath, hostId];
      const boundaryId = context.asyncState.nextBoundaryId++;
      context.asyncState.boundaries.push({
        id: boundaryId,
        shadowPath: nestedPath,
        promise: prepared.boundaryPromise,
      });
      if (prepared.immediateHostAttributes) {
        for (const [k, v] of Object.entries(prepared.immediateHostAttributes)) {
          instance.setAttribute?.(k, v);
        }
      }
      const hostAttrStr = serializeHostAttributeString(instance, {
        eventAttrs: adapterEventAttrs,
        adoptKeys,
        adoptedUrls,
        hostId,
        domPaths: context.domPaths,
      });
      yield `<${normalizedTag}${hostAttrStr}>`;
      yield templateOpenTag;
      if (styleTag) yield styleTag;
      yield `<!--$b:${boundaryId}--><slot name="pending">`;
      if (prepared.pendingContent !== undefined) {
        context.asyncState.shadowPath.push(hostId);
        try {
          yield* renderInternal(prepared.pendingContent, context, maxDepth, slotManager);
        } finally {
          context.asyncState.shadowPath.pop();
        }
      }
      yield `</slot><!--/$b:${boundaryId}--></template>`;
      if (start < end) {
        yield* renderPlanV2Opcodes(opcodes, values, context, maxDepth, slotManager, start, end);
      }
      yield `</${normalizedTag}>`;
      return;
    }

    const effectiveDeferHydration = Boolean(context.deferHydration || ((context.litShadowDepth ?? 0) > 0 && context.hydratableScope !== false && !isServerElementClassOrInstance(Ctor, instance)));

    const { eventAttrs } = prepareAndRunComponentLifecycle({
      instance,
      Ctor,
      tagName: normalizedTag,
      staticAttrs,
      dynamicAttrs,
      values,
      lightOpcodes: start < end ? { opcodes, values, start, end } : undefined,
      parentHost: prevParentHost,
      contextLookup: context.contextLookup,
      onError: context.onError,
      strictLifecycle: context.strictLifecycle,
      resumable: context.resumable,
      deferHydration: effectiveDeferHydration,
      shouldCallConnectedCallback: context.shouldCallConnectedCallback,
      skipChangedTracking: true,
    });

    context.parentHost = instance;

    if (!componentHasShadowRoot(instance, Ctor)) {
      const stateJson = context.resumable ? context.compilerBridge.serializeComponentState(instance, context) : '';
      const hostAttrStr = serializeHostAttributeString(instance, {
        eventAttrs,
        stateJson,
        domPaths: context.domPaths,
        deferHydration: effectiveDeferHydration,
      });
      yield `<${normalizedTag}${hostAttrStr}>`;
      if (typeof instance.render === 'function') {
        const lightRenderResult = instance.render();
        yield* renderShadowBodyWithAsyncTracking(instance, lightRenderResult, context, maxDepth, slotManager, false);
      }
      if (start < end) {
        yield* renderPlanV2Opcodes(opcodes, values, context, maxDepth, slotManager, start, end);
      }
      yield `</${normalizedTag}>`;
      return;
    }

    const { templateOpenTag, styleTag, adoptKeys, adoptedUrls } = buildShadowStyleAndTemplateOpen(Ctor, context);
    const shadowResult = instance.render?.();
    const stateJson = context.resumable ? context.compilerBridge.serializeComponentState(instance, context) : '';

    if (!isFlattened) {
      if (context.asyncState && context.streamingMode !== 'in-order' && shadowMayContainAsyncBoundary(shadowResult, context)) {
        const hostId = context.asyncState.nextHostId++;
        const hostAttrStr = serializeHostAttributeString(instance, {
          eventAttrs,
          adoptKeys,
          adoptedUrls,
          hostId,
          stateJson,
          domPaths: context.domPaths,
          deferHydration: effectiveDeferHydration,
        });

        // Stream host open tag immediately without buffering shadow subtrees
        yield `<${normalizedTag}${hostAttrStr}>`;
        yield templateOpenTag;
        if (styleTag) yield styleTag;
        context.asyncState.shadowPath.push(hostId);
        try {
          yield* renderShadowBodyWithAsyncTracking(instance, shadowResult, context, maxDepth, slotManager, true);
        } finally {
          context.asyncState.shadowPath.pop();
        }
        yield '</template>';
      } else {
        const hostAttrStr = serializeHostAttributeString(instance, {
          eventAttrs,
          adoptKeys,
          adoptedUrls,
          stateJson,
          domPaths: context.domPaths,
          deferHydration: effectiveDeferHydration,
        });
        yield `<${normalizedTag}${hostAttrStr}>`;
        yield templateOpenTag;
        if (styleTag) yield styleTag;
        yield* renderShadowBodyWithAsyncTracking(instance, shadowResult, context, maxDepth, slotManager, true);
        yield '</template>';
      }

      if (start < end) {
        yield* renderPlanV2Opcodes(opcodes, values, context, maxDepth, slotManager, start, end);
      }

      yield `</${normalizedTag}>`;
    } else {
      const hostAttrStr = serializeHostAttributeString(instance, {
        eventAttrs,
        domPaths: context.domPaths,
        deferHydration: effectiveDeferHydration,
      });
      yield `<${normalizedTag}${hostAttrStr}>`;
      yield* renderShadowBodyWithAsyncTracking(instance, shadowResult, context, maxDepth, slotManager, false);
      yield `</${normalizedTag}>`;
    }
  } finally {
    context.parentHost = prevParentHost;
    context.depth--;
    if (slotCtx) {
      slotManager.popContext();
    }
  }
}

function* emitMarkerStart(op: { name: string }): IterableIterator<string> {
  yield `<?start name="${op.name}">`;
}

function renderSyncDsdValueToString(val: unknown, context: SsrRenderContext, maxDepth: number, slotManager: SlotManager): string {
  if (val === null || val === undefined) return '';
  if (typeof val === 'string') return val.length > 0 ? escapeHtml(val) : '';
  if (typeof val === 'number' || typeof val === 'boolean' || typeof val === 'bigint') return String(val);
  if (typeof val === 'symbol') return '';

  if (context.depth > maxDepth) {
    throw new RangeError('Maximum SSR render depth exceeded');
  }

  if (isCompiledTemplateResult(val)) {
    const plan = resolveCompiledPlan(val, !context.edge);
    if (!plan) {
      throw new Error('[@lit-core/ssr] Uncompiled Lit template encountered in edge mode. Templates must be compiled ahead of time via @lit-core/html-aot or bundler plugins.');
    }
    const compiled = compileDsdSteps(plan.opcodes);
    const prevHydratable = context.hydratableScope;
    context.hydratableScope = isHydratableTemplate(val);
    context.depth++;
    try {
      return renderCompiledDsdStepsToString(compiled.steps, plan.opcodes, val.values, context, maxDepth, slotManager);
    } finally {
      context.depth--;
      context.hydratableScope = prevHydratable;
    }
  } else if (isStandardTemplateResult(val) && !context.edge) {
    const plan = resolveStandardPlan(val, true);
    const compiled = compileDsdSteps(plan.opcodes);
    const templateValues = templateValuesOf(val);
    const prevHydratable = context.hydratableScope;
    context.hydratableScope = isHydratableTemplate(val);
    context.depth++;
    try {
      return renderCompiledDsdStepsToString(compiled.steps, plan.opcodes, templateValues, context, maxDepth, slotManager);
    } finally {
      context.depth--;
      context.hydratableScope = prevHydratable;
    }
  } else if (Array.isArray(val)) {
    context.depth++;
    try {
      let arrOut = '';
      for (let i = 0; i < val.length; i++) {
        arrOut += renderSyncDsdValueToString(val[i], context, maxDepth, slotManager);
      }
      return arrOut;
    } finally {
      context.depth--;
    }
  }

  let fallbackOut = '';
  for (const chunk of renderInternal(val, context, maxDepth, slotManager)) {
    fallbackOut += chunk;
  }
  return fallbackOut;
}

function renderSyncCustomElementToString(
  tagName: string,
  normalizedTag: string,
  tagUpper: string,
  Ctor: new () => any,
  opcodes: SsrOpcode[],
  values: unknown[],
  start: number,
  end: number,
  context: SsrRenderContext,
  maxDepth: number,
  slotManager: SlotManager,
  staticAttrs?: Record<string, string>,
  dynamicAttrs?: SsrDynamicAttribute[],
): string {
  if (context.depth >= maxDepth) {
    throw new RangeError('Maximum SSR render depth exceeded');
  }
  if (!isValidTagName(normalizedTag)) {
    throw new Error(`[@lit-core/ssr] Invalid custom element tag name '${tagName}'.`);
  }

  const meta = getCtorSsrMeta(Ctor);
  const instance = new Ctor();
  const prevParentHost = context.parentHost;
  context.depth++;

  try {
    context.customElementRendered?.(normalizedTag);
    const isServerInstance = meta.isServerElementCtor || Boolean(instance?.[SERVER_ELEMENT_SYMBOL]);
    const effectiveDeferHydration = Boolean(context.deferHydration || ((context.litShadowDepth ?? 0) > 0 && context.hydratableScope !== false && !isServerInstance));

    const canInlineZeroAttrFastPath =
      meta.canFastPathLifecycle &&
      instance instanceof HTMLElementStub &&
      !staticAttrs &&
      (!dynamicAttrs || dynamicAttrs.length === 0) &&
      start >= end &&
      !context.shouldCallConnectedCallback &&
      hasNoLifecycleExtensions(instance);

    let eventAttrs: string[] = EMPTY_EVENT_ATTRS;
    if (canInlineZeroAttrFastPath) {
      instance.tagName = tagUpper;
      instance.isConnected = true;
      if (meta.accessorProps.length > 0) {
        repairShadowedClassFields(instance, meta.accessorProps);
      }
      instance._ssrParentHost = prevParentHost ?? null;
      if (context.contextLookup) {
        instance._ssrContextLookup = context.contextLookup;
      }
      (instance as any).isUpdatePending = false;
    } else {
      eventAttrs = prepareAndRunComponentLifecycle({
        instance,
        Ctor,
        tagName: normalizedTag,
        staticAttrs,
        dynamicAttrs,
        values,
        lightOpcodes: start < end ? { opcodes, values, start, end } : undefined,
        parentHost: prevParentHost,
        contextLookup: context.contextLookup,
        onError: context.onError,
        strictLifecycle: context.strictLifecycle,
        resumable: context.resumable,
        deferHydration: effectiveDeferHydration,
        shouldCallConnectedCallback: context.shouldCallConnectedCallback,
        skipChangedTracking: true,
      }).eventAttrs;
    }

    context.parentHost = instance;

    if (!canInlineZeroAttrFastPath && !componentHasShadowRoot(instance, Ctor)) {
      const stateJson = context.resumable ? context.compilerBridge.serializeComponentState(instance, context) : '';
      const hostAttrStr = serializeHostAttributeString(instance, {
        eventAttrs,
        stateJson,
        domPaths: context.domPaths,
        deferHydration: effectiveDeferHydration,
      });
      let out = `<${normalizedTag}${hostAttrStr}>`;
      if (typeof instance.render === 'function') {
        out += renderSyncDsdValueToString(instance.render(), context, maxDepth, slotManager);
      }
      if (start < end) {
        for (const chunk of renderPlanV2Opcodes(opcodes, values, context, maxDepth, slotManager, start, end)) {
          out += chunk;
        }
      }
      out += `</${normalizedTag}>`;
      return out;
    }

    let shadowPrefix: string;
    let hostAttrStr: string;
    if (!context.cssFuse && !context.nonce && !context.adoptedStyleSheets?.urlResolver) {
      shadowPrefix = meta.plainNoCssFuseShadowPrefix;
      const stateJson = context.resumable ? context.compilerBridge.serializeComponentState(instance, context) : '';
      if (instance instanceof HTMLElementStub && !instance._getRawAttributesMap()?.size && !context.domPaths && !stateJson && eventAttrs.length === 0) {
        hostAttrStr = effectiveDeferHydration ? ' defer-hydration' : '';
      } else {
        hostAttrStr = serializeHostAttributeString(instance, {
          eventAttrs,
          stateJson,
          domPaths: context.domPaths,
          deferHydration: effectiveDeferHydration,
        });
      }
    } else {
      const { templateOpenTag, styleTag, adoptKeys, adoptedUrls } = buildShadowStyleAndTemplateOpen(Ctor, context);
      shadowPrefix = `${templateOpenTag}${styleTag}`;
      const stateJson = context.resumable ? context.compilerBridge.serializeComponentState(instance, context) : '';
      hostAttrStr = serializeHostAttributeString(instance, {
        eventAttrs,
        adoptKeys,
        adoptedUrls,
        stateJson,
        domPaths: context.domPaths,
        deferHydration: effectiveDeferHydration,
      });
    }

    const shadowResult = instance.render?.();
    let out = `<${normalizedTag}${hostAttrStr}>${shadowPrefix}`;
    if (!isThenable(shadowResult) && shadowResult !== undefined && shadowResult !== null) {
      const incrementLitShadow = meta.isHydratableLitHost && !isServerInstance;
      if (incrementLitShadow) {
        context.litShadowDepth = (context.litShadowDepth ?? 0) + 1;
      }
      try {
        out += renderSyncDsdValueToString(shadowResult, context, maxDepth, slotManager);
      } finally {
        if (incrementLitShadow) {
          context.litShadowDepth = Math.max(0, (context.litShadowDepth ?? 1) - 1);
        }
      }
    } else if (isThenable(shadowResult)) {
      Promise.resolve(shadowResult).catch(() => {});
      if (typeof instance.renderPending === 'function') {
        out += renderSyncDsdValueToString(instance.renderPending(), context, maxDepth, slotManager);
      }
    }
    out += '</template>';

    if (start < end) {
      for (const chunk of renderPlanV2Opcodes(opcodes, values, context, maxDepth, slotManager, start, end)) {
        out += chunk;
      }
    }

    out += `</${normalizedTag}>`;
    return out;
  } finally {
    context.parentHost = prevParentHost;
    context.depth--;
  }
}

function renderCompiledDsdStepsToString(steps: CompiledDsdStep[], opcodes: SsrOpcode[], values: unknown[], context: SsrRenderContext, maxDepth: number, slotManager: SlotManager): string {
  let out = '';
  let sIdx = 0;
  const sLen = steps.length;
  while (sIdx < sLen) {
    const step = steps[sIdx];
    switch (step.kind) {
      case 'html': {
        out += step.html;
        sIdx++;
        break;
      }
      case 'part': {
        const rawVal = step.index < values.length ? values[step.index] : undefined;
        out += renderSyncDsdValueToString(rawVal, context, maxDepth, slotManager);
        sIdx++;
        break;
      }
      case 'dynamic-open': {
        const dynStr = renderDynamicAttrsToString(step.dynamicAttrs, step.tagUpper, values, context.resumable);
        out += `${step.openPrefix}${dynStr}${step.closeToken}`;
        sIdx++;
        break;
      }
      case 'custom-open': {
        const Ctor = !step.hasExistingDsd && !isElementExcluded(step.tagLower, context.excludeElements) ? context.customElements?.get(step.tag) : undefined;
        if (Ctor) {
          out += renderSyncCustomElementToString(
            step.tag,
            step.tagLower,
            step.tagUpper,
            Ctor,
            opcodes,
            values,
            step.childStart,
            step.childEnd,
            context,
            maxDepth,
            slotManager,
            step.staticAttrs,
            step.dynamicAttrs,
          );
          sIdx = step.jumpStepIndex;
        } else {
          const dynStr = step.dynamicAttrs ? renderDynamicAttrsToString(step.dynamicAttrs, step.tagUpper, values, context.resumable) : '';
          out += `${step.openPrefix}${dynStr}${step.closeToken}`;
          sIdx++;
        }
        break;
      }
      case 'marker-start': {
        for (const chunk of emitMarkerStart(step.op)) {
          out += chunk;
        }
        sIdx++;
        break;
      }
    }
  }
  return out;
}

function* renderCompiledDsdSteps(steps: CompiledDsdStep[], opcodes: SsrOpcode[], values: unknown[], context: SsrRenderContext, maxDepth: number, slotManager: SlotManager): IterableIterator<string> {
  let sIdx = 0;
  const sLen = steps.length;
  while (sIdx < sLen) {
    const step = steps[sIdx];
    switch (step.kind) {
      case 'html': {
        yield step.html;
        sIdx++;
        break;
      }
      case 'part': {
        const rawVal = step.index < values.length ? values[step.index] : undefined;
        if (rawVal === null || rawVal === undefined) {
          // Fast skip null / undefined
        } else if (typeof rawVal === 'string') {
          if (rawVal.length > 0) {
            yield escapeHtml(rawVal);
          }
        } else if (typeof rawVal === 'number' || typeof rawVal === 'boolean' || typeof rawVal === 'bigint') {
          yield String(rawVal);
        } else {
          yield* renderInternal(rawVal, context, maxDepth, slotManager);
        }
        sIdx++;
        break;
      }
      case 'dynamic-open': {
        const dynStr = renderDynamicAttrsToString(step.dynamicAttrs, step.tagUpper, values, context.resumable);
        yield `${step.openPrefix}${dynStr}${step.closeToken}`;
        sIdx++;
        break;
      }
      case 'custom-open': {
        const Ctor = !step.hasExistingDsd && !isElementExcluded(step.tagLower, context.excludeElements) ? context.customElements?.get(step.tag) : undefined;
        if (Ctor) {
          yield* renderCustomElementWithOpcodeChildren(step.tag, Ctor, opcodes, values, step.childStart, step.childEnd, context, maxDepth, slotManager, step.staticAttrs, step.dynamicAttrs);
          sIdx = step.jumpStepIndex;
        } else {
          const dynStr = step.dynamicAttrs ? renderDynamicAttrsToString(step.dynamicAttrs, step.tagUpper, values, context.resumable) : '';
          yield `${step.openPrefix}${dynStr}${step.closeToken}`;
          sIdx++;
        }
        break;
      }
      case 'marker-start': {
        yield* emitMarkerStart(step.op);
        sIdx++;
        break;
      }
    }
  }
}

export function* renderPlanV2Opcodes(
  opcodes: SsrOpcode[],
  values: unknown[],
  context: SsrRenderContext,
  maxDepth: number,
  slotManager: SlotManager,
  start = 0,
  end = opcodes.length,
): IterableIterator<string> {
  if (context.mode === 'dsd' && start === 0 && end === opcodes.length) {
    const compiled = compileDsdSteps(opcodes);
    if (!context.asyncState) {
      const rendered = renderCompiledDsdStepsToString(compiled.steps, opcodes, values, context, maxDepth, slotManager);
      if (rendered.length > 0) {
        yield rendered;
      }
      return;
    }
    yield* renderCompiledDsdSteps(compiled.steps, opcodes, values, context, maxDepth, slotManager);
    return;
  }

  let i = start;
  while (i < end) {
    const op = opcodes[i];
    switch (op.type) {
      case 'open': {
        const Ctor = op.isCustomElement && !isElementExcluded(op.tag.toLowerCase(), context.excludeElements) ? context.customElements?.get(op.tag) : undefined;
        const closeTagIndex = findMatchingCloseTag(opcodes, i, end);

        if (Ctor && closeTagIndex >= i) {
          const childStart = i + 1;
          const childEnd = op.isVoid || op.isSelfClosing || closeTagIndex === i ? i + 1 : closeTagIndex;
          if (!hasExistingDeclarativeShadowRoot(opcodes, childStart, childEnd)) {
            yield* renderCustomElementWithOpcodeChildren(op.tag, Ctor, opcodes, values, childStart, childEnd, context, maxDepth, slotManager, op.staticAttrs, op.dynamicAttrs);
            i = closeTagIndex > i ? closeTagIndex + 1 : i + 1;
            continue;
          }
        }

        let renderedAttrs = renderStaticAttrsToString(op.staticAttrs);
        if (op.dynamicAttrs) {
          renderedAttrs += renderDynamicAttrsToString(op.dynamicAttrs, op.tag.toUpperCase(), values, context.resumable);
        }

        if (op.tag === 'slot' && context.mode === 'flattened') {
          let slotName = '';
          if (op.staticAttrs && 'name' in op.staticAttrs) {
            slotName = (op.staticAttrs.name || '').trim();
          } else if (op.dynamicAttrs) {
            const dynName = op.dynamicAttrs.find((d) => d.type === 'attribute' && d.name === 'name');
            if (dynName) {
              const raw = dynName.index < values.length ? values[dynName.index] : undefined;
              if (raw !== null && raw !== undefined) {
                slotName = String(raw).trim();
              }
            }
          }

          const currentCtx = slotManager.currentContext;
          if (currentCtx?.hasAssignedNodes(slotName)) {
            const assigned = currentCtx.getAssignedNodes(slotName);
            for (const node of assigned) {
              if (node.opcodes && node.startIndex !== undefined && node.endIndex !== undefined) {
                yield* renderPlanV2Opcodes(node.opcodes, node.values ?? values, context, maxDepth, slotManager, node.startIndex, node.endIndex);
              } else if (node.content !== undefined) {
                if (typeof node.content === 'string') {
                  yield node.content;
                } else {
                  yield* renderInternal(node.content, context, maxDepth, slotManager);
                }
              }
            }
          } else if (closeTagIndex > i + 1) {
            yield* renderPlanV2Opcodes(opcodes, values, context, maxDepth, slotManager, i + 1, closeTagIndex);
          }

          i = closeTagIndex > i ? closeTagIndex + 1 : i + 1;
          continue;
        }

        const closeToken = op.isSelfClosing ? '/>' : '>';
        yield `<${op.tag}${renderedAttrs}${closeToken}`;
        break;
      }
      case 'close': {
        yield `</${op.tag}>`;
        break;
      }
      case 'text': {
        if (op.value.length > 0) {
          yield op.value;
        }
        break;
      }
      case 'comment': {
        yield `<!--${op.value}-->`;
        break;
      }
      case 'part': {
        const rawVal = op.index < values.length ? values[op.index] : undefined;
        yield* renderInternal(rawVal, context, maxDepth, slotManager);
        break;
      }
      case 'marker-start': {
        yield* emitMarkerStart(op);
        break;
      }
      case 'marker-end': {
        yield `<?end>`;
        break;
      }
    }
    i++;
  }
}

function* renderShadowBodyWithAsyncTracking(
  instance: any,
  shadowResult: unknown,
  context: SsrRenderContext,
  maxDepth: number,
  slotManager: SlotManager,
  isShadowRoot = true,
): IterableIterator<string> {
  const incrementLitShadow = isShadowRoot && isClientHydratableLitHost(instance?.constructor, instance);
  if (incrementLitShadow) {
    context.litShadowDepth = (context.litShadowDepth ?? 0) + 1;
  }
  try {
    if (isThenable(shadowResult)) {
      const p = Promise.resolve(shadowResult);
      p.catch(() => {});
      if (context.asyncState && context.mode === 'dsd') {
        const boundaryId = context.asyncState.nextBoundaryId++;
        context.asyncState.boundaries.push({
          id: boundaryId,
          shadowPath: [...context.asyncState.shadowPath],
          promise: p,
        });
        yield `<!--$b:${boundaryId}-->`;
        if (typeof instance.renderPending === 'function') {
          yield* renderInternal(instance.renderPending(), context, maxDepth, slotManager);
        } else {
          yield '<slot name="pending"></slot>';
        }
        yield `<!--/$b:${boundaryId}-->`;
      } else if (typeof instance.renderPending === 'function') {
        yield* renderInternal(instance.renderPending(), context, maxDepth, slotManager);
      }
      return;
    }

    if (shadowResult !== undefined && shadowResult !== null) {
      yield* renderInternal(shadowResult, context, maxDepth, slotManager);
    }
  } finally {
    if (incrementLitShadow) {
      context.litShadowDepth = Math.max(0, (context.litShadowDepth ?? 1) - 1);
    }
  }
}

function* renderComponentInstance(instance: HTMLElementStub, context: SsrRenderContext, maxDepth: number, slotManager: SlotManager): IterableIterator<string> {
  const ctor = instance.constructor;
  const tagName = (instance.tagName ? instance.tagName.toLowerCase() : (ctor as any).is || 'custom-element').toLowerCase();
  if (!isValidTagName(tagName)) {
    throw new Error(`[@lit-core/ssr] Invalid custom element tag name '${tagName}'.`);
  }

  if (isElementExcluded(tagName, context.excludeElements)) {
    const hostAttrStr = serializeHostAttributeString(instance, {
      domPaths: context.domPaths,
    });
    yield `<${tagName}${hostAttrStr}></${tagName}>`;
    return;
  }

  context.customElementRendered?.(tagName);
  const prevParentHost = context.parentHost;
  const effectiveDeferHydration = Boolean(context.deferHydration || ((context.litShadowDepth ?? 0) > 0 && context.hydratableScope !== false && !isServerElementClassOrInstance(ctor, instance)));
  prepareAndRunComponentLifecycle({
    instance,
    Ctor: ctor,
    tagName,
    parentHost: prevParentHost,
    contextLookup: context.contextLookup,
    onError: context.onError,
    strictLifecycle: context.strictLifecycle,
    resumable: context.resumable,
    deferHydration: effectiveDeferHydration,
    shouldCallConnectedCallback: context.shouldCallConnectedCallback,
  });
  context.parentHost = instance;

  if (!componentHasShadowRoot(instance, ctor)) {
    const stateJson = context.resumable ? context.compilerBridge.serializeComponentState(instance, context) : '';
    const hostAttrStr = serializeHostAttributeString(instance, {
      stateJson,
      domPaths: context.domPaths,
      deferHydration: effectiveDeferHydration,
    });
    yield `<${tagName}${hostAttrStr}>`;
    if (typeof (instance as any).render === 'function') {
      slotManager.pushContext(tagName);
      try {
        yield* renderShadowBodyWithAsyncTracking(instance, (instance as any).render(), context, maxDepth, slotManager, false);
      } finally {
        slotManager.popContext();
      }
    }
    yield `</${tagName}>`;
    context.parentHost = prevParentHost;
    return;
  }

  const { templateOpenTag, styleTag, adoptKeys, adoptedUrls } = buildShadowStyleAndTemplateOpen(ctor, context);
  const shadowResult = (instance as any).render?.();
  const stateJson = context.resumable ? context.compilerBridge.serializeComponentState(instance, context) : '';

  const isFlattened = context.mode !== 'dsd';
  if (isFlattened) {
    slotManager.pushContext(tagName);
  }
  try {
    if (!isFlattened) {
      if (context.asyncState && context.streamingMode !== 'in-order' && shadowMayContainAsyncBoundary(shadowResult, context)) {
        const hostId = context.asyncState.nextHostId++;
        const hostAttrStr = serializeHostAttributeString(instance, {
          adoptKeys,
          adoptedUrls,
          hostId,
          stateJson,
          domPaths: context.domPaths,
          deferHydration: effectiveDeferHydration,
        });

        // Stream host open tag immediately without buffering shadow subtrees
        yield `<${tagName}${hostAttrStr}>`;
        yield templateOpenTag;
        if (styleTag) yield styleTag;
        context.asyncState.shadowPath.push(hostId);
        try {
          yield* renderShadowBodyWithAsyncTracking(instance, shadowResult, context, maxDepth, slotManager, true);
        } finally {
          context.asyncState.shadowPath.pop();
        }
        yield '</template>';
      } else {
        const hostAttrStr = serializeHostAttributeString(instance, {
          adoptKeys,
          adoptedUrls,
          stateJson,
          domPaths: context.domPaths,
          deferHydration: effectiveDeferHydration,
        });
        yield `<${tagName}${hostAttrStr}>`;
        yield templateOpenTag;
        if (styleTag) yield styleTag;
        yield* renderShadowBodyWithAsyncTracking(instance, shadowResult, context, maxDepth, slotManager, true);
        yield '</template>';
      }

      yield `</${tagName}>`;
    } else {
      const hostAttrStr = serializeHostAttributeString(instance, {
        domPaths: context.domPaths,
        deferHydration: effectiveDeferHydration,
      });
      yield `<${tagName}${hostAttrStr}>`;
      yield* renderShadowBodyWithAsyncTracking(instance, shadowResult, context, maxDepth, slotManager, false);
      yield `</${tagName}>`;
    }
  } finally {
    context.parentHost = prevParentHost;
    if (isFlattened) {
      slotManager.popContext();
    }
  }
}
