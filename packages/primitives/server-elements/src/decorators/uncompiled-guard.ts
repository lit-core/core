import { UncompiledServerElementError } from '../errors.js';

/** A decorator usable in both the TypeScript legacy and the TC39 standard form. */
export type ServerMethodDecorator = (target: any, memberOrContext: any, descriptor?: PropertyDescriptor) => any;

function isTestMode(): boolean {
  const flags = globalThis as Record<string, unknown>;
  return Boolean(flags.__LIT_SERVER_ELEMENTS_TEST_MODE__ || flags.__ALLOW_UNCOMPILED_SERVER_ELEMENTS__);
}

/** Resolves the member and class names a decorator was applied to, whichever decorator form is in use. */
function describeTarget(target: any, memberOrContext: any): { memberName: string; targetName: string } {
  if (typeof memberOrContext === 'object' && memberOrContext !== null && 'kind' in memberOrContext) {
    return { memberName: String(memberOrContext.name ?? 'unknown'), targetName: 'ServerElement' };
  }
  if (typeof memberOrContext === 'string' || typeof memberOrContext === 'symbol') {
    return { memberName: String(memberOrContext), targetName: (target && typeof target === 'object' && target.constructor?.name) || 'ServerElement' };
  }
  return { memberName: 'unknown', targetName: 'ServerElement' };
}

/**
 * Builds the decorator `@loader()` and `@action()` share.
 *
 * In compiled code `@lit-core/server-split` lowers and removes the decorator, so this body never runs.
 * Evaluating it means the file reached the runtime uncompiled, which would put server code in a client
 * bundle, so it throws `UncompiledServerElementError`. Tests opt out with a global flag and get the
 * options attached to the method as metadata.
 */
export function createServerDecorator(kind: 'loader' | 'action', metadataSymbol: symbol, options: object | undefined): ServerMethodDecorator {
  return (target, memberOrContext, descriptor) => {
    if (!isTestMode()) {
      const { memberName, targetName } = describeTarget(target, memberOrContext);
      throw new UncompiledServerElementError(kind, memberName, targetName);
    }

    const metadata = options || {};
    if (descriptor && typeof descriptor.value === 'function') {
      descriptor.value[metadataSymbol] = metadata;
      return descriptor;
    }
    if (typeof target === 'function') {
      target[metadataSymbol] = metadata;
      return target;
    }
    return descriptor || target;
  };
}
