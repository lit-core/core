import { compileLitDescriptorPlan, compileTemplatePlan } from './compiler.js';
import type { CompiledTemplateResult, SsrTemplatePlanV2 } from './compiler-bridge.js';

export const templatePlanCache = new WeakMap<TemplateStringsArray, SsrTemplatePlanV2>();

export const descriptorPlanCache = new WeakMap<object, SsrTemplatePlanV2>();

/** A descriptor that may carry its plan, as the ahead-of-time compiler leaves it. */
interface PlanCarrier {
  ssrPlan?: SsrTemplatePlanV2;
}

/**
 * The plan for an ahead-of-time compiled template. A plan the compiler shipped with the descriptor,
 * or one cached earlier, is returned as is. Otherwise it is compiled and cached when `compileMissing`
 * is set (never on the edge, where compiling is not allowed), and `undefined` is returned when it is not.
 */
export function resolveCompiledPlan(value: CompiledTemplateResult, compileMissing: true): SsrTemplatePlanV2;
export function resolveCompiledPlan(value: CompiledTemplateResult, compileMissing: boolean): SsrTemplatePlanV2 | undefined;
export function resolveCompiledPlan(value: CompiledTemplateResult, compileMissing: boolean): SsrTemplatePlanV2 | undefined {
  const descriptor = value._$litType$ as PlanCarrier;
  let plan = descriptor.ssrPlan || descriptorPlanCache.get(value._$litType$);
  if (!plan && compileMissing) {
    plan = compileLitDescriptorPlan(value._$litType$);
    descriptor.ssrPlan = plan;
    descriptorPlanCache.set(value._$litType$, plan);
  }
  return plan;
}

/** The plan for a standard `html` template result, compiled once per template strings array when `compileMissing` is set. */
type StandardTemplate = { strings: TemplateStringsArray; _$litType$?: unknown };
export function resolveStandardPlan(value: StandardTemplate, compileMissing: true): SsrTemplatePlanV2;
export function resolveStandardPlan(value: StandardTemplate, compileMissing: boolean): SsrTemplatePlanV2 | undefined;
export function resolveStandardPlan(value: StandardTemplate, compileMissing: boolean): SsrTemplatePlanV2 | undefined {
  let plan = (value._$litType$ as PlanCarrier | undefined)?.ssrPlan || templatePlanCache.get(value.strings);
  if (!plan && compileMissing) {
    plan = compileTemplatePlan(Array.from(value.strings));
    templatePlanCache.set(value.strings, plan);
  }
  return plan;
}
