import { createAsyncRenderState } from './async-state.js';
import { compileHtmlDocumentPlan } from './compiler.js';
import { isBoundaryPayload, type SsrAsyncRenderState, type SsrPendingBoundaryEntry, type SsrRenderContext } from './compiler-bridge.js';
import { findLastBodyCloseOpcode } from './render-api.js';
import { DEFAULT_BOUNDARY_TIMEOUT_MS } from './render-constants.js';
import { hasExpandableCustomElement } from './render-guards.js';
import type { RenderOptions } from './render-options.js';
import { createSsrRenderContext, flushStyleDeduplicationScripts, render, renderInternal, renderPlanV2Opcodes } from './renderer.js';
import { RevealCoordinator } from './reveal-groups.js';
import { formatSdsdBootstrapScript, formatSdsdTailChunk } from './sdsd-scripts.js';
import type { SlotManager } from './slot.js';

/** What to show in place of a boundary that failed: `{ content }` when a fallback applies, `undefined` when the failure leaves the placeholder as it is. */
type FailureFallback = { content: unknown } | undefined;

/**
 * Reports a failed boundary and resolves its fallback: the boundary's own, else the render-wide one.
 *
 * A fallback is author code and can fail too. That failure is reported (`phase: 'errorFallback'`) and
 * treated as no fallback, so one broken fallback cannot abort the stream for every other boundary.
 */
function resolveFailureFallback(entry: SsrPendingBoundaryEntry, options: RenderOptions, error: unknown): FailureFallback {
  options.onError?.(error, { phase: 'asyncBoundary' });
  try {
    if (entry.errorFallback) {
      return { content: entry.errorFallback(error) };
    }
    if (options.errorFallback !== undefined) {
      return { content: typeof options.errorFallback === 'function' ? (options.errorFallback as (err: unknown) => unknown)(error) : options.errorFallback };
    }
  } catch (fallbackError) {
    options.onError?.(fallbackError, { phase: 'errorFallback' });
  }
  return undefined;
}

export async function renderHtmlDocumentAsync(html: string, options: RenderOptions = {}): Promise<string> {
  if (!html) return html;
  const plan = compileHtmlDocumentPlan(html);
  const asyncState = createAsyncRenderState();
  const { context, maxDepth, slotManager } = createSsrRenderContext(options, asyncState);
  if (!hasExpandableCustomElement(plan.opcodes, context.customElements, context.excludeElements)) {
    return html;
  }

  const bodyCloseIdx = findLastBodyCloseOpcode(plan.opcodes);
  let out = '';
  if (bodyCloseIdx >= 0) {
    for (const chunk of renderPlanV2Opcodes(plan.opcodes, [], context, maxDepth, slotManager, 0, bodyCloseIdx)) {
      out += chunk;
    }
    if (asyncState.boundaries.length > 0 && !options.signal?.aborted) {
      for await (const chunk of drainPendingBoundariesOutOfOrder(asyncState, context, maxDepth, slotManager, options)) {
        out += chunk;
      }
    } else {
      for (const chunk of flushStyleDeduplicationScripts(context)) {
        out += chunk;
      }
    }
    for (const chunk of renderPlanV2Opcodes(plan.opcodes, [], context, maxDepth, slotManager, bodyCloseIdx, plan.opcodes.length)) {
      out += chunk;
    }
  } else {
    for (const chunk of renderPlanV2Opcodes(plan.opcodes, [], context, maxDepth, slotManager, 0, plan.opcodes.length)) {
      out += chunk;
    }
    if (asyncState.boundaries.length > 0 && !options.signal?.aborted) {
      for await (const chunk of drainPendingBoundariesOutOfOrder(asyncState, context, maxDepth, slotManager, options)) {
        out += chunk;
      }
    } else {
      for (const chunk of flushStyleDeduplicationScripts(context)) {
        out += chunk;
      }
    }
  }
  return out;
}

export function wrapBoundaryPromiseWithDeadline(entry: SsrPendingBoundaryEntry, timeoutMs?: number, signal?: AbortSignal): Promise<{ id: number; ok: boolean; value: unknown }> {
  const effectiveTimeoutMs = timeoutMs === undefined ? DEFAULT_BOUNDARY_TIMEOUT_MS : timeoutMs;

  return new Promise((resolve) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const onAbort = () => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      resolve({
        id: entry.id,
        ok: false,
        value: signal?.reason ?? new Error('SSR stream aborted'),
      });
    };

    if (signal) {
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener('abort', onAbort, { once: true });
    }

    if (typeof effectiveTimeoutMs === 'number' && Number.isFinite(effectiveTimeoutMs) && effectiveTimeoutMs > 0) {
      timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener('abort', onAbort);
        resolve({
          id: entry.id,
          ok: false,
          value: new Error(`SSR async boundary ${entry.id} timed out after ${effectiveTimeoutMs}ms`),
        });
      }, effectiveTimeoutMs);
    }

    entry.promise.then(
      (val) => {
        if (settled) return;
        settled = true;
        if (timer !== undefined) clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        resolve({ id: entry.id, ok: true, value: val });
      },
      (err) => {
        if (settled) return;
        settled = true;
        if (timer !== undefined) clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        resolve({ id: entry.id, ok: false, value: err });
      },
    );
  });
}

/** What a boundary's promise settled to, after the deadline wrapper. */
type BoundaryOutcome = { id: number; ok: boolean; value: unknown };

export async function* drainPendingBoundariesOutOfOrder(
  asyncState: SsrAsyncRenderState,
  context: SsrRenderContext,
  maxDepth: number,
  slotManager: SlotManager,
  options: RenderOptions = {},
): AsyncIterableIterator<string> {
  if (asyncState.boundaries.length === 0) {
    yield* flushStyleDeduplicationScripts(context);
    return;
  }

  if (!asyncState.bootstrapEmitted) {
    asyncState.bootstrapEmitted = true;
    yield formatSdsdBootstrapScript(options.nonce);
  }

  const inFlight = new Map<
    number,
    {
      entry: SsrPendingBoundaryEntry;
      raced: Promise<{ id: number; ok: boolean; value: unknown }>;
    }
  >();

  const reveal = new RevealCoordinator<BoundaryOutcome>();

  /** Renders one settled boundary to its swap chunk, or nothing when it failed without a fallback. */
  function* emitSettled(entry: SsrPendingBoundaryEntry, settled: BoundaryOutcome): IterableIterator<string> {
    let valueToRender: unknown;
    let hostAttributes: Record<string, string | null> | undefined;
    let shouldEmitSwap = true;

    if (settled.ok) {
      if (isBoundaryPayload(settled.value)) {
        valueToRender = settled.value.content;
        hostAttributes = settled.value.hostAttributes;
      } else {
        valueToRender = settled.value;
      }
    } else {
      const fallback = resolveFailureFallback(entry, options, settled.value);
      if (fallback) {
        valueToRender = fallback.content;
      } else {
        shouldEmitSwap = false;
      }
    }

    if (shouldEmitSwap) {
      const prevShadowPath = [...asyncState.shadowPath];
      asyncState.shadowPath.length = 0;
      asyncState.shadowPath.push(...entry.shadowPath);
      let chunkHtml = '';
      try {
        for (const piece of renderInternal(valueToRender, context, maxDepth, slotManager)) {
          chunkHtml += piece;
        }
      } finally {
        asyncState.shadowPath.length = 0;
        asyncState.shadowPath.push(...prevShadowPath);
      }

      const chunkId = `c${asyncState.nextChunkId++}`;
      const isSvg = Boolean(valueToRender !== null && typeof valueToRender === 'object' && (valueToRender as any)._$litType$ === 2);
      yield formatSdsdTailChunk(chunkId, entry.shadowPath, entry.id, chunkHtml, options.nonce, isSvg, hostAttributes);
      for (const styleScript of flushStyleDeduplicationScripts(context)) {
        yield styleScript;
      }
    }
  }

  const enqueuePending = () => {
    while (asyncState.boundaries.length > 0) {
      const entry = asyncState.boundaries.shift();
      if (!entry) break;
      reveal.register(entry);
      inFlight.set(entry.id, {
        entry,
        raced: wrapBoundaryPromiseWithDeadline(entry, options.timeoutMs, options.signal),
      });
    }
  };

  enqueuePending();

  while (inFlight.size > 0) {
    if (options.signal?.aborted) {
      break;
    }

    const settled = await Promise.race(Array.from(inFlight.values(), (item) => item.raced));
    const record = inFlight.get(settled.id);
    if (!record) continue;
    inFlight.delete(settled.id);

    if (options.signal?.aborted) {
      break;
    }

    for (const ready of reveal.settle({ entry: record.entry, outcome: settled })) {
      yield* emitSettled(ready.entry, ready.outcome);
    }

    enqueuePending();
  }

  yield* flushStyleDeduplicationScripts(context);
}

export async function* renderInOrderInternal(value: unknown, options: RenderOptions): AsyncIterableIterator<string> {
  const asyncState = createAsyncRenderState();
  const { context, maxDepth, slotManager } = createSsrRenderContext({ ...options, streamingMode: 'in-order' }, asyncState);
  let rawShell = '';
  for (const chunk of renderInternal(value, context, maxDepth, slotManager)) {
    rawShell += chunk;
  }

  if (asyncState.boundaries.length === 0) {
    if (rawShell.length > 0) yield rawShell;
    yield* flushStyleDeduplicationScripts(context);
    return;
  }

  const boundaryById = new Map<number, SsrPendingBoundaryEntry>();
  for (const entry of asyncState.boundaries) {
    boundaryById.set(entry.id, entry);
  }

  let cursor = 0;
  const startMarkerRegex = /<!--\$b:(\d+)-->/g;
  let match = startMarkerRegex.exec(rawShell);

  while (match !== null) {
    if (options.signal?.aborted) break;
    const boundaryId = Number(match[1]);
    const markerStart = match.index;
    const contentStart = markerStart + match[0].length;
    const endMarker = `<!--/$b:${boundaryId}-->`;
    const endMarkerIdx = rawShell.indexOf(endMarker, contentStart);

    if (endMarkerIdx === -1) {
      break;
    }

    if (markerStart > cursor) {
      yield rawShell.slice(cursor, markerStart);
    }

    const fallbackHtml = rawShell.slice(contentStart, endMarkerIdx);
    const entry = boundaryById.get(boundaryId);

    if (entry) {
      const settled = await wrapBoundaryPromiseWithDeadline(entry, options.timeoutMs, options.signal);
      if (options.signal?.aborted) break;

      if (settled.ok) {
        const inner = isBoundaryPayload(settled.value) ? settled.value.content : settled.value;
        yield* renderInOrderInternal(inner, options);
      } else {
        const fallback = resolveFailureFallback(entry, options, settled.value);
        if (fallback) {
          yield* renderInOrderInternal(fallback.content, options);
        } else if (fallbackHtml.length > 0) {
          yield fallbackHtml;
        }
      }
    } else if (fallbackHtml.length > 0) {
      yield fallbackHtml;
    }

    cursor = endMarkerIdx + endMarker.length;
    startMarkerRegex.lastIndex = cursor;
    match = startMarkerRegex.exec(rawShell);
  }

  if (!options.signal?.aborted && cursor < rawShell.length) {
    yield rawShell.slice(cursor);
  }
  yield* flushStyleDeduplicationScripts(context);
}

export function createSyncAndAsyncBoundaryIterators(
  value: unknown,
  options: RenderOptions = {},
): {
  syncIterator: IterableIterator<string>;
  hasPendingBoundaries: () => boolean;
  createAsyncDrainIterator: () => AsyncIterableIterator<string>;
} {
  const streamingMode = options.streamingMode ?? 'out-of-order';
  if (streamingMode === 'sync' || (options.mode ?? 'dsd') === 'flattened') {
    return {
      syncIterator: render(value, options),
      hasPendingBoundaries: () => false,
      createAsyncDrainIterator: async function* () {},
    };
  }

  const asyncState = createAsyncRenderState();
  const { context, maxDepth, slotManager } = createSsrRenderContext(options, asyncState);
  function* syncWithStyles(): IterableIterator<string> {
    yield* renderInternal(value, context, maxDepth, slotManager);
    if (asyncState.boundaries.length === 0) {
      yield* flushStyleDeduplicationScripts(context);
    }
  }

  return {
    syncIterator: syncWithStyles(),
    hasPendingBoundaries: () => asyncState.boundaries.length > 0,
    createAsyncDrainIterator: () => drainPendingBoundariesOutOfOrder(asyncState, context, maxDepth, slotManager, options),
  };
}

export async function* renderAsync(value: unknown, options: RenderOptions = {}): AsyncIterableIterator<string> {
  const streamingMode = options.streamingMode ?? 'out-of-order';

  if (streamingMode === 'sync' || (options.mode ?? 'dsd') === 'flattened') {
    for (const chunk of render(value, options)) {
      if (options.signal?.aborted) break;
      yield chunk;
    }
    return;
  }

  if (streamingMode === 'in-order') {
    yield* renderInOrderInternal(value, options);
    return;
  }

  const asyncState = createAsyncRenderState();
  const { context, maxDepth, slotManager } = createSsrRenderContext(options, asyncState);

  for (const chunk of renderInternal(value, context, maxDepth, slotManager)) {
    if (options.signal?.aborted) return;
    yield chunk;
  }

  if (asyncState.boundaries.length > 0 && !options.signal?.aborted) {
    yield* drainPendingBoundariesOutOfOrder(asyncState, context, maxDepth, slotManager, options);
  } else if (!options.signal?.aborted) {
    yield* flushStyleDeduplicationScripts(context);
  }
}

export async function renderToStringAsync(value: unknown, options?: RenderOptions): Promise<string> {
  let result = '';
  for await (const chunk of renderAsync(value, options)) {
    result += chunk;
  }
  return result;
}

export async function collectResult(result: Iterable<string> | AsyncIterable<string> | ReadableStream<Uint8Array>): Promise<string> {
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

  if (result && typeof (result as any)[Symbol.asyncIterator] === 'function') {
    let accumulated = '';
    for await (const chunk of result as AsyncIterable<string>) {
      accumulated += chunk;
    }
    return accumulated;
  }

  if (result && typeof (result as any)[Symbol.iterator] === 'function') {
    let accumulated = '';
    for (const chunk of result as Iterable<string>) {
      accumulated += chunk;
    }
    return accumulated;
  }

  return '';
}
