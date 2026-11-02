import { UncompiledServerElementError } from '../errors.js';
import { ACTION_SYMBOL } from '../symbols.js';
import type { ActionOptions } from '../types.js';

function isTestMode(): boolean {
  if (typeof globalThis === 'undefined') return false;
  const g = globalThis as Record<string, unknown>;
  return Boolean(g.__LIT_SERVER_ELEMENTS_TEST_MODE__ || g.__ALLOW_UNCOMPILED_SERVER_ELEMENTS__);
}

/**
 * Decorator defining an edge mutation action RPC endpoint.
 *
 * In compiled code, this decorator is lowered and eliminated by @lit-core/server-split.
 * In uncompiled environments, evaluating this decorator throws UncompiledServerElementError.
 */
export function action(options?: ActionOptions): any {
  return (targetOrValue: any, propertyKeyOrContext: any, descriptor?: PropertyDescriptor) => {
    let memberName = 'unknown';
    let targetName = 'ServerElement';

    if (typeof propertyKeyOrContext === 'object' && propertyKeyOrContext !== null && 'kind' in propertyKeyOrContext) {
      // TC39 Stage 3 decorator
      memberName = String(propertyKeyOrContext.name ?? 'unknown');
    } else if (typeof propertyKeyOrContext === 'string' || typeof propertyKeyOrContext === 'symbol') {
      // TypeScript legacy decorator
      memberName = String(propertyKeyOrContext);
      if (targetOrValue && typeof targetOrValue === 'object') {
        targetName = targetOrValue.constructor?.name || 'ServerElement';
      }
    }

    if (!isTestMode()) {
      throw new UncompiledServerElementError('action', memberName, targetName);
    }

    // Test mode bypass: attach metadata
    if (descriptor && typeof descriptor.value === 'function') {
      (descriptor.value as any)[ACTION_SYMBOL] = options || {};
      return descriptor;
    }
    if (typeof targetOrValue === 'function') {
      (targetOrValue as any)[ACTION_SYMBOL] = options || {};
      return targetOrValue;
    }
    return descriptor || targetOrValue;
  };
}
