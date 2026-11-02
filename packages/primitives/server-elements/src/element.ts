import { LitElement } from 'lit';
import { ActionStateController } from './action-state.js';
import type { ActionContext, Env, LoaderContext } from './context.js';
import { CONTEXT_SYMBOL, ELEMENT_SYMBOL } from './symbols.js';
import type { ActionState, Constructor } from './types.js';

export interface ServerElementInterface {
  readonly env: Env;
  readonly context: LoaderContext | ActionContext;
  readonly actionState: ActionStateController;
  isActionPending(actionName: string): boolean;
  getActionState<T = unknown>(actionName: string): ActionState<T>;
}

/**
 * Mixin augmenting a LitElement base class with server element reactivity and context access.
 */
export function ServerElementMixin<T extends Constructor<LitElement>>(Base: T): T & (new (...args: any[]) => ServerElementInterface) {
  class ServerElementMixinClass extends Base implements ServerElementInterface {
    readonly _actionController: ActionStateController;
    [CONTEXT_SYMBOL]: LoaderContext | ActionContext | null = null;

    constructor(...args: any[]) {
      super(...args);
      this._actionController = new ActionStateController(this);
      (this as any)[ELEMENT_SYMBOL] = true;
    }

    /**
     * Edge bindings environment, available during server-side execution.
     */
    get env(): Env {
      const ctx = this[CONTEXT_SYMBOL];
      if (ctx && 'env' in ctx) {
        return ctx.env;
      }
      return (globalThis as any).env || {};
    }

    /**
     * Current execution context (LoaderContext or ActionContext).
     */
    get context(): LoaderContext | ActionContext {
      const ctx = this[CONTEXT_SYMBOL];
      if (!ctx) {
        throw new Error('Server element context is not available outside edge execution.');
      }
      return ctx;
    }

    /**
     * Sets the internal execution context during edge rendering/action invocation.
     * @internal
     */
    _setContext(ctx: LoaderContext | ActionContext): void {
      this[CONTEXT_SYMBOL] = ctx;
    }

    /**
     * Checks if a specific action is currently executing on the client.
     */
    isActionPending(actionName: string): boolean {
      return this._actionController.isActionPending(actionName);
    }

    /**
     * Retrieves the reactive state snapshot for a given action.
     */
    getActionState<T = unknown>(actionName: string): ActionState<T> {
      return this._actionController.getActionState<T>(actionName);
    }

    /**
     * Retrieves the underlying ActionStateController instance.
     */
    get actionState(): ActionStateController {
      return this._actionController;
    }
  }

  return ServerElementMixinClass as unknown as T & (new (...args: any[]) => ServerElementInterface);
}

const BaseServerElement = ServerElementMixin(LitElement);

/**
 * Pre-composed LitElement base class for server elements.
 */
export class ServerElement extends BaseServerElement implements ServerElementInterface {}
