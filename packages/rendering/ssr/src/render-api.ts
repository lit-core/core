import { createAsyncRenderState } from './async-state.js';
import { compileHtmlDocumentPlan } from './compiler.js';
import type { SsrAsyncRenderState, SsrOpcode, SsrRenderContext } from './compiler-bridge.js';
import { hasExpandableCustomElement } from './render-guards.js';
import type { RenderOptions } from './render-options.js';
import { createSsrRenderContext, flushStyleDeduplicationScripts, renderInternal, renderPlanV2Opcodes } from './renderer.js';
import { formatAdoptedUrlFallbackScript, formatCssAdoptScript } from './sdsd-scripts.js';
import type { SlotManager } from './slot.js';

export function renderWithPendingBoundaries(
  value: unknown,
  options: RenderOptions = {},
  existingAsyncState?: SsrAsyncRenderState,
  existingContextState?: { context: SsrRenderContext; maxDepth: number; slotManager: SlotManager },
): {
  html: string;
  asyncState: SsrAsyncRenderState;
  context: SsrRenderContext;
  maxDepth: number;
  slotManager: SlotManager;
} {
  const asyncState = existingAsyncState ?? existingContextState?.context.asyncState ?? createAsyncRenderState();
  const { context, maxDepth, slotManager } = existingContextState ?? createSsrRenderContext(options, asyncState);
  let html = '';
  for (const chunk of renderInternal(value, context, maxDepth, slotManager)) {
    html += chunk;
  }
  return { html, asyncState, context, maxDepth, slotManager };
}

export function renderToString(value: unknown, options?: RenderOptions): string {
  const { context, maxDepth, slotManager } = createSsrRenderContext(options);
  let result = '';
  for (const chunk of renderInternal(value, context, maxDepth, slotManager)) {
    result += chunk;
  }
  if (context.mode === 'dsd') {
    const urlEntries = context.styleDeduplicator.flushAdoptedUrlSheets();
    if (urlEntries.length > 0) {
      result += formatAdoptedUrlFallbackScript(urlEntries, context.nonce);
    }
    const adoptState = context.styleDeduplicator.consumePendingInlineAdoption();
    if (adoptState.needsCall) {
      result += formatCssAdoptScript(adoptState.needsBootstrap, context.nonce);
    }
  }
  return result;
}

export function findLastBodyCloseOpcode(opcodes: SsrOpcode[]): number {
  for (let i = opcodes.length - 1; i >= 0; i--) {
    const op = opcodes[i];
    if (op.type === 'close' && op.tag === 'body') {
      return i;
    }
  }
  return -1;
}

export function renderHtmlDocument(html: string, options: RenderOptions = {}): string {
  if (!html) return html;
  const plan = compileHtmlDocumentPlan(html);
  const { context, maxDepth, slotManager } = createSsrRenderContext(options);
  if (!hasExpandableCustomElement(plan.opcodes, context.customElements, context.excludeElements)) {
    return html;
  }

  const bodyCloseIdx = findLastBodyCloseOpcode(plan.opcodes);
  let out = '';
  if (bodyCloseIdx >= 0) {
    for (const chunk of renderPlanV2Opcodes(plan.opcodes, [], context, maxDepth, slotManager, 0, bodyCloseIdx)) {
      out += chunk;
    }
    for (const chunk of flushStyleDeduplicationScripts(context)) {
      out += chunk;
    }
    for (const chunk of renderPlanV2Opcodes(plan.opcodes, [], context, maxDepth, slotManager, bodyCloseIdx, plan.opcodes.length)) {
      out += chunk;
    }
  } else {
    for (const chunk of renderPlanV2Opcodes(plan.opcodes, [], context, maxDepth, slotManager, 0, plan.opcodes.length)) {
      out += chunk;
    }
    for (const chunk of flushStyleDeduplicationScripts(context)) {
      out += chunk;
    }
  }
  return out;
}
