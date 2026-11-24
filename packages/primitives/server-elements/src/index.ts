/**
 * Authoring surface: what component files import. Server runtime and browser runtime live behind
 * their own entry points so a component bundle never pulls in the other side:
 *
 * - `@lit-core/server-elements/edge`: rendering and `HTMLRewriter` integration
 * - `@lit-core/server-elements/action-endpoint`: the action RPC handler
 * - `@lit-core/server-elements/crypto`: state signing
 * - `@lit-core/server-elements/client`: browser action dispatch and patch executor
 */

export { ACTION_ERROR_STATUS, ActionError, type ActionErrorCode, type ActionErrorOptions, isActionError } from './action-error.js';
export { ActionStateController } from './action-state.js';
export type { ActionContext, Env, LoaderContext } from './context.js';
export { action } from './decorators/action.js';
export { loader } from './decorators/loader.js';
export { ServerElement, type ServerElementInterface, ServerElementMixin } from './element.js';
export { isReloadRequired, ServerActionError, UncompiledServerElementError } from './errors.js';
export type { ActionMeta, LoaderMeta, ServerElementClass, ServerElementRegistry } from './metadata.js';
export { ACTION_STATE_SYMBOL, ACTION_SYMBOL, CONTEXT_SYMBOL, ELEMENT_SYMBOL, LOADER_SYMBOL } from './symbols.js';
export type * from './types.js';
