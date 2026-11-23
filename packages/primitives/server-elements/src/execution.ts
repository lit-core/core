import type { ActionContext, LoaderContext } from './context.js';
import type { LoaderHost, LoaderMeta, ServerElementInstance } from './metadata.js';
import { CONTEXT_SYMBOL } from './symbols.js';

/** Name of the conventional loader method used when a class declares no compiled `@loader()` metadata. */
const IMPLICIT_LOADER = 'load';

/** Attaches the request-scoped context to an element instance, whichever base class it extends. */
export function bindContext(instance: ServerElementInstance, context: LoaderContext | ActionContext): void {
  if (typeof instance._setContext === 'function') {
    instance._setContext(context);
  } else {
    instance[CONTEXT_SYMBOL] = context;
  }
}

/**
 * Executes a server element loader method on the edge Worker.
 */
export async function executeServerLoader(instance: ServerElementInstance, context: LoaderContext, loaderName = IMPLICIT_LOADER): Promise<void> {
  bindContext(instance, context);
  const loaderFn = instance[loaderName];
  if (typeof loaderFn !== 'function') {
    return;
  }
  await loaderFn.call(instance, context.env, context);
}

/**
 * Executes a server element action method on the edge Worker.
 */
export async function executeServerAction<T = unknown>(instance: ServerElementInstance, context: ActionContext, actionName: string, args: unknown[]): Promise<T> {
  bindContext(instance, context);
  const actionFn = instance[actionName];
  if (typeof actionFn !== 'function') {
    throw new Error(`Action method '${actionName}' not found on component instance.`);
  }
  return await actionFn.apply(instance, args);
}

/** Names of the loaders an element declares: compiled `@loader()` methods, or the implicit `load()` method. */
export function declaredLoaderNames(ElementClass: LoaderHost, instance: ServerElementInstance): string[] {
  const compiled = ElementClass?.__lit_loaders;
  if (compiled && typeof compiled === 'object') {
    return Object.keys(compiled);
  }
  return typeof instance?.[IMPLICIT_LOADER] === 'function' ? [IMPLICIT_LOADER] : [];
}

/** Loaders to re-run after an action wrote `mutated`: those without declared `dependencies`, and those depending on a written property. */
export function loadersAffectedBy(ElementClass: LoaderHost, instance: ServerElementInstance, mutated: ReadonlySet<string>): string[] {
  const compiled: Record<string, LoaderMeta> | undefined = ElementClass?.__lit_loaders;
  return declaredLoaderNames(ElementClass, instance).filter((name) => {
    const dependencies = compiled?.[name]?.dependencies;
    return dependencies === undefined || dependencies.some((prop) => mutated.has(prop));
  });
}

/**
 * Runs loaders of an element concurrently.  By default every declared loader runs; pass `only` to run a subset.
 *
 * Loaders are independent data fetches, so awaiting them one after another would add their
 * latencies together. Every loader is allowed to settle before a failure is reported, so no
 * loader is left writing to the instance after the render or action has already failed.
 * Loaders that write the same property race; each should own distinct properties.
 */
export async function runLoaders(
  instance: ServerElementInstance,
  ElementClass: LoaderHost,
  context: LoaderContext,
  only: readonly string[] = declaredLoaderNames(ElementClass, instance),
): Promise<void> {
  const settled = await Promise.allSettled(only.map((name) => executeServerLoader(instance, context, name)));
  const failure = settled.find((result): result is PromiseRejectedResult => result.status === 'rejected');
  if (failure) {
    throw failure.reason;
  }
}
