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
 * Extract and restore reactive properties from <script type="lit/state"> inside the element.
 */
export declare function restoreComponentState(host: HTMLElement): Record<string, unknown> | null;
/**
 * Scan a TemplateResult for event handlers and bind them to matching DOM nodes in shadow root.
 */
export declare function bindTemplateEventHandlers(shadowRoot: DocumentFragment | HTMLElement, templateResult: any, host: any): void;
/**
 * Class mixin adding resumable hydration-free upgrade to any LitElement or ReactiveElement.
 */
export declare function withResumable<T extends new (...args: any[]) => any>(Base: T): T;
/**
 * Globally install the resumable adapter on Lit's ReactiveElement prototype.
 */
export declare function installResumableAdapter(LitElementOrReactiveElementClass?: any): void;
//# sourceMappingURL=adapter.d.ts.map