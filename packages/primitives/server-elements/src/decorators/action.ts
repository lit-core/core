import { ACTION_SYMBOL } from '../symbols.js';
import type { ActionOptions } from '../types.js';
import { createServerDecorator, type ServerMethodDecorator } from './uncompiled-guard.js';

/**
 * Decorator defining an edge mutation action RPC endpoint.
 *
 * In compiled code, this decorator is lowered and eliminated by @lit-core/server-split.
 * In uncompiled environments, evaluating this decorator throws UncompiledServerElementError.
 */
export function action(options?: ActionOptions): ServerMethodDecorator {
  return createServerDecorator('action', ACTION_SYMBOL, options);
}
