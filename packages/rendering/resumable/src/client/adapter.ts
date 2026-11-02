import {
  bindTemplateEventHandlersInternal,
  type HydratedTemplateRoot,
  installLitHydrationSupport,
  parseComponentStateInternal,
  restoreStateFromHostAttribute,
  withResumableInternal,
} from './hydrate.js';

export interface ResumableElement extends HTMLElement {
  hasUpdated?: boolean;
  renderRoot?: DocumentFragment | HTMLElement;
  render?: () => any;
  update?: (changedProperties: Map<PropertyKey, unknown>) => void;
  willUpdate?: (changedProperties: Map<PropertyKey, unknown>) => void;
  firstUpdated?: (changedProperties: Map<PropertyKey, unknown>) => void;
  updated?: (changedProperties: Map<PropertyKey, unknown>) => void;
  connectedCallback?: () => void;
}

/**
 * Parse state from serialized `data-lit-state` JSON text.
 */
export function parseComponentState(rawState: string): Record<string, unknown> {
  return parseComponentStateInternal(rawState);
}

/**
 * Extract and restore reactive properties from `data-lit-state` on the host element.
 */
export function restoreComponentState(host: HTMLElement): Record<string, unknown> | null {
  return restoreStateFromHostAttribute(host);
}

/**
 * Bind event handlers and live DOM part slots on an existing Declarative Shadow DOM root.
 */
export function bindTemplateEventHandlers(shadowRoot: DocumentFragment | HTMLElement, templateResult: any, host: any): HydratedTemplateRoot | null {
  return bindTemplateEventHandlersInternal(shadowRoot, templateResult, host);
}

/**
 * Class mixin adding non-destructive hydration and `data-lit-state` restoration to a LitElement subclass.
 */
export function withResumable<T extends new (...args: any[]) => any>(Base: T): T {
  return withResumableInternal(Base);
}

/**
 * Globally install LitElement hydration support (`globalThis.litElementHydrateSupport` + customElements hook).
 */
export function installResumableAdapter(LitElementOrReactiveElementClass?: any): void {
  installLitHydrationSupport(LitElementOrReactiveElementClass);
}
