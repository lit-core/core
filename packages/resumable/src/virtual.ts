/**
 * Self-contained in-memory source for virtual:lit-core/resumable-adapter.
 * Bundles the hydration-free resumable client adapter and interaction replay queue.
 */
export const RESUMABLE_ADAPTER_SOURCE = `
export const RESUMED_EVENT_FLAG = '__lit_resumed__';

export function parseComponentState(scriptContent) {
  if (!scriptContent || !scriptContent.trim()) {
    return {};
  }
  return JSON.parse(scriptContent.trim());
}

export function restoreComponentState(host) {
  if (!host || typeof host.querySelector !== 'function') {
    return null;
  }
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
      } catch {}
    }
    stateScript.remove();
    return state;
  } catch (err) {
    console.error('[resumable] Failed to parse lit/state snapshot:', err);
    return null;
  }
}

export function bindTemplateEventHandlers(shadowRoot, templateResult, host) {
  if (!templateResult || typeof templateResult !== 'object' || !templateResult.strings) {
    return;
  }
  const strings = templateResult.strings;
  const values = templateResult.values;
  if (!Array.isArray(strings) || !Array.isArray(values)) {
    return;
  }
  const eventRegex = /@([a-zA-Z0-9_-]+)=\\s*["']?$/;
  const allElements = Array.from(shadowRoot.querySelectorAll('*'));
  for (let i = 0; i < values.length; i++) {
    const stringPrefix = strings[i];
    const match = eventRegex.exec(stringPrefix);
    if (!match) continue;
    const eventName = match[1];
    const handler = values[i];
    if (typeof handler === 'function') {
      if (allElements.length > 0) {
        const targetEl = allElements[Math.min(i, allElements.length - 1)];
        if (targetEl) {
          targetEl.addEventListener(eventName, handler.bind(host));
        }
      }
    }
  }
  const actionElements = shadowRoot.querySelectorAll('[data-action]');
  actionElements.forEach((el) => {
    const actionName = el.getAttribute('data-action');
    if (actionName && typeof host[actionName] === 'function') {
      el.addEventListener('click', (e) => host[actionName](e));
    }
  });
}

export function withResumable(Base) {
  return class extends Base {
    connectedCallback() {
      restoreComponentState(this);
      if (typeof super.connectedCallback === 'function') {
        super.connectedCallback();
      }
      if (typeof this.requestUpdate === 'function') {
        this.requestUpdate();
      }
    }
    createRenderRoot() {
      if (this.shadowRoot) {
        return this.shadowRoot;
      }
      return typeof super.createRenderRoot === 'function' ? super.createRenderRoot() : this.attachShadow({ mode: 'open' });
    }
    update(changedProperties) {
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
      if (typeof super.update === 'function') {
        super.update(changedProperties);
      }
    }
  };
}

let isAdapterInstalled = false;

export function installResumableAdapter(LitElementOrReactiveElementClass) {
  if (isAdapterInstalled && !LitElementOrReactiveElementClass) {
    return;
  }
  let targetProto = null;
  if (LitElementOrReactiveElementClass?.prototype) {
    targetProto = LitElementOrReactiveElementClass.prototype;
  } else if (typeof window !== 'undefined') {
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

export function createReplayedEvent(origEvent) {
  const type = origEvent.type;
  const baseInit = {
    bubbles: origEvent.bubbles ?? true,
    cancelable: origEvent.cancelable ?? true,
    composed: origEvent.composed ?? true,
  };
  let replayed;
  try {
    if (typeof PointerEvent !== 'undefined' && origEvent instanceof PointerEvent) {
      replayed = new PointerEvent(type, {
        ...baseInit,
        clientX: origEvent.clientX,
        clientY: origEvent.clientY,
        screenX: origEvent.screenX,
        screenY: origEvent.screenY,
        button: origEvent.button,
        buttons: origEvent.buttons,
        ctrlKey: origEvent.ctrlKey,
        shiftKey: origEvent.shiftKey,
        altKey: origEvent.altKey,
        metaKey: origEvent.metaKey,
        pointerId: origEvent.pointerId,
        pointerType: origEvent.pointerType,
        pressure: origEvent.pressure,
        tiltX: origEvent.tiltX,
        tiltY: origEvent.tiltY,
        width: origEvent.width,
        height: origEvent.height,
        isPrimary: origEvent.isPrimary,
      });
    } else if (typeof MouseEvent !== 'undefined' && origEvent instanceof MouseEvent) {
      replayed = new MouseEvent(type, {
        ...baseInit,
        clientX: origEvent.clientX,
        clientY: origEvent.clientY,
        screenX: origEvent.screenX,
        screenY: origEvent.screenY,
        button: origEvent.button,
        buttons: origEvent.buttons,
        ctrlKey: origEvent.ctrlKey,
        shiftKey: origEvent.shiftKey,
        altKey: origEvent.altKey,
        metaKey: origEvent.metaKey,
      });
    } else if (typeof KeyboardEvent !== 'undefined' && origEvent instanceof KeyboardEvent) {
      replayed = new KeyboardEvent(type, {
        ...baseInit,
        key: origEvent.key,
        code: origEvent.code,
        location: origEvent.location,
        ctrlKey: origEvent.ctrlKey,
        shiftKey: origEvent.shiftKey,
        altKey: origEvent.altKey,
        metaKey: origEvent.metaKey,
        repeat: origEvent.repeat,
      });
    } else if (typeof FocusEvent !== 'undefined' && origEvent instanceof FocusEvent) {
      replayed = new FocusEvent(type, {
        ...baseInit,
        relatedTarget: origEvent.relatedTarget,
      });
    } else if (typeof CustomEvent !== 'undefined') {
      replayed = new CustomEvent(type, {
        ...baseInit,
        detail: origEvent.detail,
      });
    } else {
      replayed = new Event(type, baseInit);
    }
  } catch {
    replayed = new CustomEvent(type, baseInit);
  }
  Object.defineProperty(replayed, RESUMED_EVENT_FLAG, {
    value: true,
    enumerable: false,
    configurable: true,
  });
  return replayed;
}

export function replayEvent(buffered) {
  const { event: origEvent, target, host } = buffered;
  const dispatchTarget = target && target.isConnected ? target : host;
  if (!dispatchTarget || typeof dispatchTarget.dispatchEvent !== 'function') {
    return false;
  }
  const replayed = createReplayedEvent(origEvent);
  return dispatchTarget.dispatchEvent(replayed);
}

export function replayQueue(queue) {
  while (queue.length > 0) {
    const item = queue.shift();
    if (item) {
      replayEvent(item);
    }
  }
}
`;
