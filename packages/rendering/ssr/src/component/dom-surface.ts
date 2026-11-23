import { defineElementProperty } from '../element-utils.js';
import { CSSStyleSheetStub, HTMLElementStub, ShadowRootStub, ValidityStateStub } from '../environment.js';
import { findReactiveElementPrototype } from './ctor-meta.js';

export function attachNonStubDomSurface(instance: any): void {
  if (instance instanceof HTMLElementStub) {
    return;
  }
  if (!Array.isArray(instance._ssrLightChildren)) {
    defineElementProperty(instance, '_ssrLightChildren', []);
  }
  if (!Array.isArray(instance._ssrLightChildNodes)) {
    defineElementProperty(instance, '_ssrLightChildNodes', []);
  }

  const accessorKeys = ['children', 'childNodes', 'childElementCount', 'firstChild', 'lastChild', 'firstElementChild', 'lastElementChild', 'textContent', 'ownerDocument'] as const;
  for (const key of accessorKeys) {
    if (key in instance && instance[key] !== undefined) continue;
    const desc = Object.getOwnPropertyDescriptor(HTMLElementStub.prototype, key);
    if (desc) {
      try {
        Object.defineProperty(instance, key, { ...desc, enumerable: false, configurable: true });
      } catch {}
    }
  }

  const methodKeys = ['querySelector', 'querySelectorAll', 'closest', 'contains', 'getRootNode', 'attachInternals'] as const;
  for (const key of methodKeys) {
    if (typeof instance[key] !== 'function') {
      defineElementProperty(instance, key, (HTMLElementStub.prototype as any)[key]);
    }
  }
  if (typeof instance.getRootNode === 'function') {
    const origGetRootNode = instance.getRootNode.bind(instance);
    defineElementProperty(instance, 'getRootNode', function (this: any, options?: any) {
      const root = origGetRootNode(options);
      if (root && typeof root.querySelector === 'function') {
        return root;
      }
      return this;
    });
  }

  if (typeof instance.getAttributeNames !== 'function' && Array.isArray(instance.attributes)) {
    defineElementProperty(instance, 'getAttributeNames', function (this: any): string[] {
      return Array.isArray(this.attributes) ? this.attributes.map((a: any) => String(a.name)) : [];
    });
  }

  const ensureShadowRootSurface = (sr: any) => {
    if (!sr || typeof sr !== 'object') return sr;
    if (!Array.isArray(sr.childNodes)) {
      defineElementProperty(sr, 'childNodes', []);
    }
    if (!Array.isArray(sr.children)) {
      defineElementProperty(sr, 'children', []);
    }
    if (!Array.isArray(sr.adoptedStyleSheets)) {
      defineElementProperty(sr, 'adoptedStyleSheets', []);
    }
    const srMethods = [
      'appendChild',
      'removeChild',
      'insertBefore',
      'append',
      'prepend',
      'querySelector',
      'querySelectorAll',
      'getElementById',
      'addEventListener',
      'removeEventListener',
      'dispatchEvent',
    ] as const;
    for (const m of srMethods) {
      if (typeof sr[m] !== 'function') {
        defineElementProperty(sr, m, (ShadowRootStub.prototype as any)[m]);
      }
    }
    return sr;
  };

  if (instance.__internals && typeof instance.__internals === 'object' && instance.__internals.validity && Object.getPrototypeOf(instance.__internals.validity) === Object.prototype) {
    Object.setPrototypeOf(instance.__internals.validity, ValidityStateStub.prototype);
  }

  if (instance.shadowRoot) {
    ensureShadowRootSurface(instance.shadowRoot);
  }
  if (typeof instance.attachShadow === 'function') {
    const origAttachShadow = instance.attachShadow.bind(instance);
    defineElementProperty(instance, 'attachShadow', (init: ShadowRootInit = { mode: 'open' }) => {
      const sr = origAttachShadow(init);
      return ensureShadowRootSurface(sr);
    });
  }

  // If `@lit/reactive-element` was evaluated in Node before `installIsolateGlobals()`, its module-scoped
  // `supportsAdoptingStyleSheets` flag was captured as false (`adoptStyles` falls back to `document.createElement`).
  // When `globalThis.document` is absent and the subclass did not override `createRenderRoot`, adopt sheets on the
  // ephemeral instance directly without mutating `ReactiveElement.prototype` or `globalThis`.
  if (typeof (globalThis as any).document === 'undefined') {
    const reactiveProto = findReactiveElementPrototype(instance);
    if (reactiveProto) {
      let hasUserCreateRenderRootOverride = false;
      let cursor = Object.getPrototypeOf(instance);
      while (cursor && cursor !== reactiveProto && cursor !== Object.prototype) {
        if (cursor.constructor?._$litElement$ === true) {
          break;
        }
        if (Object.hasOwn(cursor, 'createRenderRoot')) {
          hasUserCreateRenderRootOverride = true;
          break;
        }
        cursor = Object.getPrototypeOf(cursor);
      }

      if (!hasUserCreateRenderRootOverride) {
        defineElementProperty(instance, 'createRenderRoot', function (this: any) {
          const root = this.shadowRoot ?? this.attachShadow(this.constructor?.shadowRootOptions ?? { mode: 'open' });
          const styles = this.constructor?.elementStyles;
          if (root && Array.isArray(styles)) {
            root.adoptedStyleSheets = styles.map((s: any) => {
              if (s instanceof CSSStyleSheetStub) return s;
              if (s?.styleSheet) return s.styleSheet;
              const sheet = new CSSStyleSheetStub();
              if (typeof s?.cssText === 'string') {
                sheet.replaceSync(s.cssText);
              }
              return sheet;
            });
          }
          if (this.renderOptions && typeof this.renderOptions === 'object') {
            this.renderOptions.renderBefore ??= root?.firstChild;
          }
          return root;
        });
      }
    }
  }

  const origDispatch = typeof instance.dispatchEvent === 'function' ? instance.dispatchEvent.bind(instance) : null;
  defineElementProperty(instance, 'dispatchEvent', function (this: any, event: any): boolean {
    if (origDispatch) {
      origDispatch(event);
    }
    if (event?.bubbles && !event?.cancelBubble && !event?._propagationStopped && this._ssrParentHost && this.__eventTargetParent !== this._ssrParentHost) {
      this._ssrParentHost.dispatchEvent?.(event);
    }
    if (event?.type === 'context-request' && typeof event.callback === 'function' && !event._ssrHandled && !event?.cancelBubble && !event?._propagationStopped) {
      return HTMLElementStub.prototype.dispatchEvent.call(this, event);
    }
    return !event?.defaultPrevented;
  });
}

export function hasFrozenPrototypeInChain(instance: any): boolean {
  let cur = Object.getPrototypeOf(instance);
  while (cur && cur !== Object.prototype) {
    if (Object.isFrozen(cur)) return true;
    cur = Object.getPrototypeOf(cur);
  }
  return false;
}

export function setInstanceOverride(instance: any, prop: string, value: unknown, useDefine: boolean): void {
  if (useDefine) {
    Object.defineProperty(instance, prop, {
      value,
      configurable: true,
      writable: true,
      enumerable: true,
    });
  } else {
    instance[prop] = value;
  }
}
