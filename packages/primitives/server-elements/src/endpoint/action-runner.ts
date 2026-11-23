import type { ActionContext } from '../context.js';
import { executeServerAction, loadersAffectedBy, runLoaders } from '../execution.js';
import type { ActionMeta } from '../metadata.js';
import { canonicalEqual, cloneStateValue, type DeclaredProperties } from './element-state.js';
import { trackPropertyWrites } from './write-tracker.js';

export interface ActionOutcome {
  actionResult: unknown;
  /** Value of every tracked property immediately before the action ran. */
  preActionSnapshot: Map<string, unknown>;
  /**
   * Re-runs the loaders the action affected, then re-applies the action's own writes on top.
   * `null` when nothing needs revalidating, so callers can skip a second response phase.
   */
  revalidate: (() => Promise<void>) | null;
}

/**
 * Executes an action on a rehydrated element instance and prepares loader revalidation.
 *
 * Revalidation is returned rather than run, so a streaming response can deliver the action's own
 * patches first and the (often slower) loader-derived patches afterwards. An explicit action write
 * always wins over a loader refreshing the same property.
 */
export async function runAction(
  instance: any,
  ElementClass: any,
  declaredProps: DeclaredProperties,
  actionContext: ActionContext,
  actionMeta: ActionMeta,
  validatedArgs: unknown[],
): Promise<ActionOutcome> {
  const staticWrites = Array.isArray(actionMeta.writes) ? actionMeta.writes : [];
  const trackedKeys = new Set<string>([...Object.keys(declaredProps), ...staticWrites]);

  const preActionSnapshot = new Map<string, unknown>();
  for (const prop of trackedKeys) {
    preActionSnapshot.set(prop, cloneStateValue(instance[prop]));
  }

  const tracker = trackPropertyWrites(instance, trackedKeys, staticWrites);
  let actionResult: unknown;
  try {
    actionResult = await executeServerAction(instance, actionContext, actionMeta.name, validatedArgs);
  } finally {
    tracker.restore();
  }

  if (actionMeta.revalidate === false) {
    return { actionResult, preActionSnapshot, revalidate: null };
  }

  const actionMutatedProps = new Map<string, unknown>();
  for (const prop of trackedKeys) {
    if (tracker.written.has(prop) || !canonicalEqual(instance[prop], preActionSnapshot.get(prop))) {
      actionMutatedProps.set(prop, cloneStateValue(instance[prop]));
    }
  }

  const affected = loadersAffectedBy(ElementClass, instance, new Set(actionMutatedProps.keys()));
  if (affected.length === 0) {
    return { actionResult, preActionSnapshot, revalidate: null };
  }

  return {
    actionResult,
    preActionSnapshot,
    async revalidate() {
      await runLoaders(instance, ElementClass, actionContext, affected);
      for (const [prop, value] of actionMutatedProps) {
        instance[prop] = cloneStateValue(value);
      }
    },
  };
}
