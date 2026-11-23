import { LOADER_SYMBOL } from '../symbols.js';
import type { LoaderOptions } from '../types.js';
import { createServerDecorator, type ServerMethodDecorator } from './uncompiled-guard.js';

/**
 * Decorator defining an asynchronous edge data loader.
 *
 * In compiled code, this decorator is lowered and eliminated by @lit-core/server-split.
 * In uncompiled environments, evaluating this decorator throws UncompiledServerElementError.
 */
export function loader(options?: LoaderOptions): ServerMethodDecorator {
  return createServerDecorator('loader', LOADER_SYMBOL, options);
}
