import type { SsrDynamicAttribute, SsrOpcode } from './compiler-bridge.js';
import { hasExistingDeclarativeShadowRoot, renderStaticAttrsToString } from './opcode-helpers.js';
import { findMatchingCloseTag } from './slot.js';

export type CompiledDsdStep =
  | { kind: 'html'; html: string }
  | { kind: 'part'; index: number }
  | { kind: 'marker-start'; op: { name: string } }
  | {
      kind: 'dynamic-open';
      openPrefix: string;
      tagUpper: string;
      dynamicAttrs: SsrDynamicAttribute[];
      closeToken: string;
    }
  | {
      kind: 'custom-open';
      tag: string;
      tagLower: string;
      tagUpper: string;
      openPrefix: string;
      closeToken: string;
      staticAttrs?: Record<string, string>;
      dynamicAttrs?: SsrDynamicAttribute[];
      childStart: number;
      childEnd: number;
      hasExistingDsd: boolean;
      nextOpcode: number;
      jumpStepIndex: number;
    };

export interface CompiledDsdPlan {
  steps: CompiledDsdStep[];
  hasMarkerStart: boolean;
}

export const compiledDsdStepsCache = new WeakMap<SsrOpcode[], CompiledDsdPlan>();

export function compileDsdSteps(opcodes: SsrOpcode[]): CompiledDsdPlan {
  const cached = compiledDsdStepsCache.get(opcodes);
  if (cached !== undefined) {
    return cached;
  }

  const len = opcodes.length;
  const jumpTargets = new Set<number>();
  const customMetaByIdx = new Map<number, { childStart: number; childEnd: number; nextOpcode: number; hasExistingDsd: boolean }>();

  for (let i = 0; i < len; i++) {
    const op = opcodes[i];
    if (op.type === 'open' && op.isCustomElement) {
      const closeTagIndex = findMatchingCloseTag(opcodes, i, len);
      const childStart = i + 1;
      const childEnd = op.isVoid || op.isSelfClosing || closeTagIndex === i ? i + 1 : closeTagIndex;
      const nextOpcode = closeTagIndex > i ? closeTagIndex + 1 : i + 1;
      const hasExistingDsd = hasExistingDeclarativeShadowRoot(opcodes, childStart, childEnd);
      customMetaByIdx.set(i, { childStart, childEnd, nextOpcode, hasExistingDsd });
      jumpTargets.add(nextOpcode);
    }
  }

  const steps: CompiledDsdStep[] = [];
  const opcodeToStepIndex = new Map<number, number>();
  let htmlBuf = '';
  let hasMarkerStart = false;

  const flushHtml = () => {
    if (htmlBuf.length > 0) {
      steps.push({ kind: 'html', html: htmlBuf });
      htmlBuf = '';
    }
  };

  for (let i = 0; i < len; i++) {
    if (jumpTargets.has(i)) {
      flushHtml();
      opcodeToStepIndex.set(i, steps.length);
    }
    const op = opcodes[i];
    switch (op.type) {
      case 'open': {
        const staticAttrStr = renderStaticAttrsToString(op.staticAttrs);
        const closeToken = op.isSelfClosing ? '/>' : '>';
        if (op.isCustomElement) {
          flushHtml();
          const cMeta = customMetaByIdx.get(i);
          if (!cMeta) {
            throw new Error('[@lit-core/ssr] Internal error: custom element opcode has no precomputed child range.');
          }
          steps.push({
            kind: 'custom-open',
            tag: op.tag,
            tagLower: op.tag.toLowerCase(),
            tagUpper: op.tag.toUpperCase(),
            openPrefix: `<${op.tag}${staticAttrStr}`,
            closeToken,
            staticAttrs: op.staticAttrs,
            dynamicAttrs: op.dynamicAttrs,
            childStart: cMeta.childStart,
            childEnd: cMeta.childEnd,
            hasExistingDsd: cMeta.hasExistingDsd,
            nextOpcode: cMeta.nextOpcode,
            jumpStepIndex: 0,
          });
        } else if (op.dynamicAttrs && op.dynamicAttrs.length > 0) {
          flushHtml();
          steps.push({
            kind: 'dynamic-open',
            openPrefix: `<${op.tag}${staticAttrStr}`,
            tagUpper: op.tag.toUpperCase(),
            dynamicAttrs: op.dynamicAttrs,
            closeToken,
          });
        } else {
          htmlBuf += `<${op.tag}${staticAttrStr}${closeToken}`;
        }
        break;
      }
      case 'close': {
        htmlBuf += `</${op.tag}>`;
        break;
      }
      case 'text': {
        if (op.value.length > 0) {
          htmlBuf += op.value;
        }
        break;
      }
      case 'comment': {
        htmlBuf += `<!--${op.value}-->`;
        break;
      }
      case 'marker-end': {
        htmlBuf += '<?end>';
        break;
      }
      case 'marker-start': {
        flushHtml();
        hasMarkerStart = true;
        steps.push({ kind: 'marker-start', op });
        break;
      }
      case 'part': {
        flushHtml();
        steps.push({ kind: 'part', index: op.index });
        break;
      }
    }
  }

  flushHtml();
  opcodeToStepIndex.set(len, steps.length);

  for (let s = 0; s < steps.length; s++) {
    const step = steps[s];
    if (step.kind === 'custom-open') {
      step.jumpStepIndex = opcodeToStepIndex.get(step.nextOpcode) ?? steps.length;
    }
  }

  const compiled: CompiledDsdPlan = { steps, hasMarkerStart };
  compiledDsdStepsCache.set(opcodes, compiled);
  return compiled;
}
