import { html, LitElement, nothing, type TemplateResult } from 'lit';
import { ActionStateController } from './action-state.js';
import type { ActionContext, Env, LoaderContext } from './context.js';
import type { ServerElementClass } from './metadata.js';
import { DEFAULT_ROUTE_PREFIX, FORM_FIELD_PREFIX } from './protocol.js';
import { CONTEXT_SYMBOL, ELEMENT_SYMBOL, FORM_SNAPSHOT_SYMBOL } from './symbols.js';
import type { ActionState, Constructor } from './types.js';

/**
 * What an element embeds in its forms so a plain form post can authenticate: a signed ticket for its
 * identity, with no state. The server rebuilds state from the element's loaders when the form is posted.
 */
export interface FormSnapshot {
  tag: string;
  /** Signature over the element's identity at `FORM_TICKET_SEQ`. */
  sig: string;
  token: string;
  /** Public attributes and build id, exactly as the browser would echo them. */
  attrs: Record<string, string>;
}

export interface ServerElementInterface {
  actionUrl(actionName: string, routePrefix?: string): string;
  formFields(options?: { redirect?: string }): TemplateResult | typeof nothing;
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
    readonly [ELEMENT_SYMBOL] = true;

    constructor(...args: any[]) {
      super(...args);
      this._actionController = new ActionStateController(this);
    }

    /**
     * Edge bindings environment, available during server-side execution.
     */
    get env(): Env {
      const ctx = this[CONTEXT_SYMBOL];
      if (ctx && 'env' in ctx) {
        return ctx.env;
      }
      return (globalThis as { env?: Env }).env || {};
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
     * URL a plain `<form method="post">` posts to in order to run the named `@action()`.
     * Works without JavaScript: pair it with `formFields()` inside the form.
     */
    actionUrl(actionName: string, routePrefix: string = DEFAULT_ROUTE_PREFIX): string {
      const actions = (this.constructor as ServerElementClass).__lit_actions ?? {};
      const hash = Object.keys(actions).find((key) => actions[key].name === actionName);
      if (!hash) {
        throw new Error(`[@lit-core/server-elements] <${String(this.tagName ?? 'element').toLowerCase()}> has no compiled @action() named '${actionName}'.`);
      }
      return `${routePrefix.endsWith('/') ? routePrefix : `${routePrefix}/`}${hash}`;
    }

    /**
     * Hidden inputs carrying a signed ticket for this element, so a plain form post can run an action with no script.
     * The ticket holds no state, so the size of every form is the same however large the element's state is.
     * Renders nothing outside a server render, such as while computing action patches.
     *
     * Every other input in the form becomes the action's single argument object. The browser is sent
     * back to `redirect` (a same-site path) afterwards, defaulting to the page it came from.
     */
    formFields(options: { redirect?: string } = {}): TemplateResult | typeof nothing {
      const snapshot = (this as unknown as Record<symbol, FormSnapshot | undefined>)[FORM_SNAPSHOT_SYMBOL];
      if (!snapshot) return nothing;
      const name = (field: string) => `${FORM_FIELD_PREFIX}${field}`;
      return html`<input type="hidden" name=${name('tag')} value=${snapshot.tag}><input type="hidden" name=${name('sig')} value=${snapshot.sig}><input type="hidden" name=${name('token')} value=${snapshot.token}><input type="hidden" name=${name('attrs')} value=${JSON.stringify(snapshot.attrs)}>${options.redirect ? html`<input type="hidden" name=${name('redirect')} value=${options.redirect}>` : nothing}`;
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
