import { parseComponentState } from '../server/state-serializer.js';
/**
 * Extract and restore reactive properties from <script type="lit/state"> inside the element.
 */
export function restoreComponentState(host) {
    if (!host || typeof host.querySelector !== 'function') {
        return null;
    }
    // Look for direct child script with type="lit/state"
    let stateScript = null;
    const children = host.children;
    for (let i = 0; i < children.length; i++) {
        const child = children[i];
        if (child.tagName.toLowerCase() === 'script' && child.getAttribute('type') === 'lit/state') {
            stateScript = child;
            break;
        }
    }
    if (!stateScript || !stateScript.textContent) {
        return null;
    }
    try {
        const state = parseComponentState(stateScript.textContent);
        for (const [key, value] of Object.entries(state)) {
            try {
                host[key] = value;
            }
            catch {
                // In case property is read-only
            }
        }
        // Remove state script from DOM to maintain clean tree
        stateScript.remove();
        return state;
    }
    catch (err) {
        console.error('[resumable] Failed to parse lit/state snapshot:', err);
        return null;
    }
}
/**
 * Scan a TemplateResult for event handlers and bind them to matching DOM nodes in shadow root.
 */
export function bindTemplateEventHandlers(shadowRoot, templateResult, host) {
    if (!templateResult || typeof templateResult !== 'object' || !templateResult.strings) {
        return;
    }
    const strings = templateResult.strings;
    const values = templateResult.values;
    if (!Array.isArray(strings) || !Array.isArray(values)) {
        return;
    }
    // Match event bindings like @click=${...}, @input=${...}, etc.
    const eventRegex = /@([a-zA-Z0-9_-]+)=\s*["']?$/;
    const allElements = Array.from(shadowRoot.querySelectorAll('*'));
    for (let i = 0; i < values.length; i++) {
        const stringPrefix = strings[i];
        const match = eventRegex.exec(stringPrefix);
        if (!match)
            continue;
        const eventName = match[1];
        const handler = values[i];
        if (typeof handler === 'function') {
            // Find element corresponding to this binding position
            if (allElements.length > 0) {
                const targetEl = allElements[Math.min(i, allElements.length - 1)];
                if (targetEl) {
                    targetEl.addEventListener(eventName, handler.bind(host));
                }
            }
        }
    }
    // Also bind data-action delegation (@lit-core/event-hoist integration)
    const actionElements = shadowRoot.querySelectorAll('[data-action]');
    actionElements.forEach((el) => {
        const actionName = el.getAttribute('data-action');
        if (actionName && typeof host[actionName] === 'function') {
            el.addEventListener('click', (e) => host[actionName](e));
        }
    });
}
/**
 * Class mixin adding resumable hydration-free upgrade to any LitElement or ReactiveElement.
 */
export function withResumable(Base) {
    return class extends Base {
        connectedCallback() {
            // 1. Restore state from snapshot before initial render
            restoreComponentState(this);
            if (typeof super.connectedCallback === 'function') {
                super.connectedCallback();
            }
            if (typeof this.requestUpdate === 'function') {
                this.requestUpdate();
            }
        }
        createRenderRoot() {
            // 2. Attach to existing ShadowRoot (Declarative Shadow DOM)
            if (this.shadowRoot) {
                return this.shadowRoot;
            }
            return typeof super.createRenderRoot === 'function' ? super.createRenderRoot() : this.attachShadow({ mode: 'open' });
        }
        update(changedProperties) {
            const isFirstUpdate = !this.hasUpdated;
            const root = this.renderRoot || this.shadowRoot;
            // 3. Suppress initial render teardown if ShadowRoot already populated from DSD
            if (isFirstUpdate && root && root.childNodes.length > 0) {
                this.hasUpdated = true;
                if (typeof this.willUpdate === 'function') {
                    this.willUpdate(changedProperties);
                }
                // Call render to get template bindings without tearing down DOM
                let renderResult;
                if (typeof this.render === 'function') {
                    renderResult = this.render();
                    bindTemplateEventHandlers(root, renderResult, this);
                }
                if (typeof this.firstUpdated === 'function') {
                    this.firstUpdated(changedProperties);
                }
                if (typeof this.updated === 'function') {
                    this.updated(changedProperties);
                }
                return;
            }
            // Subsequent updates perform standard reactive DOM updates
            if (typeof super.update === 'function') {
                super.update(changedProperties);
            }
        }
    };
}
let isAdapterInstalled = false;
/**
 * Globally install the resumable adapter on Lit's ReactiveElement prototype.
 */
export function installResumableAdapter(LitElementOrReactiveElementClass) {
    if (isAdapterInstalled && !LitElementOrReactiveElementClass) {
        return;
    }
    let targetProto = null;
    if (LitElementOrReactiveElementClass?.prototype) {
        targetProto = LitElementOrReactiveElementClass.prototype;
    }
    else if (typeof window !== 'undefined') {
        // Attempt to locate LitElement or ReactiveElement on global or customElements
        const maybeLit = window.LitElement || window.ReactiveElement;
        if (maybeLit?.prototype) {
            targetProto = maybeLit.prototype;
        }
    }
    if (!targetProto) {
        isAdapterInstalled = true;
        return;
    }
    const origConnected = targetProto.connectedCallback;
    targetProto.connectedCallback = function () {
        restoreComponentState(this);
        if (typeof origConnected === 'function') {
            origConnected.call(this);
        }
        if (typeof this.requestUpdate === 'function') {
            this.requestUpdate();
        }
    };
    const origCreateRenderRoot = targetProto.createRenderRoot;
    targetProto.createRenderRoot = function () {
        if (this.shadowRoot) {
            return this.shadowRoot;
        }
        return origCreateRenderRoot ? origCreateRenderRoot.call(this) : this.attachShadow({ mode: 'open' });
    };
    const origUpdate = targetProto.update;
    targetProto.update = function (changedProperties) {
        const isFirstUpdate = !this.hasUpdated;
        const root = this.renderRoot || this.shadowRoot;
        if (isFirstUpdate && root && root.childNodes.length > 0) {
            this.hasUpdated = true;
            if (typeof this.willUpdate === 'function') {
                this.willUpdate(changedProperties);
            }
            if (typeof this.render === 'function') {
                const renderResult = this.render();
                bindTemplateEventHandlers(root, renderResult, this);
            }
            if (typeof this.firstUpdated === 'function') {
                this.firstUpdated(changedProperties);
            }
            if (typeof this.updated === 'function') {
                this.updated(changedProperties);
            }
            return;
        }
        if (typeof origUpdate === 'function') {
            origUpdate.call(this, changedProperties);
        }
    };
    isAdapterInstalled = true;
}
//# sourceMappingURL=adapter.js.map