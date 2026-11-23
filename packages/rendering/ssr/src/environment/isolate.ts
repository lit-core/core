import { CSSStyleSheetStub } from './constructable.js';
import { DocumentStub, defaultDocumentStub } from './document.js';
import { CustomEventStub, IntersectionObserverStub, KeyboardEventStub, MutationObserverStub, ResizeObserverStub } from './events.js';
import { HTMLElementStub } from './html-element.js';
import { type CustomElementRegistryLike, IsolateCustomElementRegistry } from './registry.js';
import { ShadowRootStub } from './shadow-root.js';

export interface IsolateEnvironment {
  customElements: IsolateCustomElementRegistry;
  HTMLElement: typeof HTMLElementStub;
  CustomEvent: typeof CustomEventStub;
  CSSStyleSheet: typeof CSSStyleSheetStub;
  KeyboardEvent: typeof KeyboardEventStub;
  MutationObserver: typeof MutationObserverStub;
  ResizeObserver: typeof ResizeObserverStub;
  IntersectionObserver: typeof IntersectionObserverStub;
  document: DocumentStub;
  Document: typeof DocumentStub;
}

export function createIsolateEnvironment(parentRegistry?: CustomElementRegistryLike): IsolateEnvironment {
  return {
    customElements: new IsolateCustomElementRegistry(parentRegistry),
    HTMLElement: HTMLElementStub,
    CustomEvent: CustomEventStub,
    CSSStyleSheet: CSSStyleSheetStub,
    KeyboardEvent: KeyboardEventStub,
    MutationObserver: MutationObserverStub,
    ResizeObserver: ResizeObserverStub,
    IntersectionObserver: IntersectionObserverStub,
    document: defaultDocumentStub,
    Document: DocumentStub,
  };
}

export function installIsolateGlobals(env?: Partial<IsolateEnvironment>): void {
  const g = globalThis as any;
  if (typeof g.HTMLElement === 'undefined') {
    g.HTMLElement = env?.HTMLElement ?? HTMLElementStub;
  }
  if (typeof g.CustomEvent === 'undefined') {
    g.CustomEvent = env?.CustomEvent ?? CustomEventStub;
  }
  if (typeof g.CSSStyleSheet === 'undefined') {
    g.CSSStyleSheet = env?.CSSStyleSheet ?? CSSStyleSheetStub;
  }
  if (typeof g.CSS === 'undefined') {
    g.CSS = {
      supports: () => false,
      escape: (s: string) => String(s),
    };
  }
  if (typeof g.customElements === 'undefined') {
    g.customElements = env?.customElements ?? new IsolateCustomElementRegistry();
  }
  if (typeof g.KeyboardEvent === 'undefined') {
    g.KeyboardEvent = env?.KeyboardEvent ?? KeyboardEventStub;
  }
  if (typeof g.MutationObserver === 'undefined') {
    g.MutationObserver = env?.MutationObserver ?? MutationObserverStub;
  }
  if (typeof g.ResizeObserver === 'undefined') {
    g.ResizeObserver = env?.ResizeObserver ?? ResizeObserverStub;
  }
  if (typeof g.IntersectionObserver === 'undefined') {
    g.IntersectionObserver = env?.IntersectionObserver ?? IntersectionObserverStub;
  }
  if (typeof g.Document === 'undefined') {
    g.Document = env?.Document ?? DocumentStub;
  }
  if (typeof g.ShadowRoot === 'undefined') {
    g.ShadowRoot = ShadowRootStub;
  }
  if (typeof g.Element === 'undefined') {
    g.Element = env?.HTMLElement ?? HTMLElementStub;
  }
  if (typeof g.DocumentFragment === 'undefined') {
    g.DocumentFragment = env?.HTMLElement ?? HTMLElementStub;
  }
  if (typeof g.window === 'undefined') {
    g.window = g;
  }
  if (typeof g.Node === 'undefined') {
    g.Node = env?.HTMLElement ?? HTMLElementStub;
  }
  if (typeof g.litServerRoot === 'undefined') {
    const RootCtor = env?.HTMLElement ?? HTMLElementStub;
    g.litServerRoot = new RootCtor('lit-server-root');
  }
  if (typeof g.Event === 'undefined') {
    g.Event = env?.CustomEvent ?? CustomEventStub;
  }
  if (typeof g.UIEvent === 'undefined') {
    g.UIEvent = env?.CustomEvent ?? CustomEventStub;
  }
  if (typeof g.MouseEvent === 'undefined') {
    g.MouseEvent = env?.CustomEvent ?? CustomEventStub;
  }
  if (typeof g.FocusEvent === 'undefined') {
    g.FocusEvent = env?.CustomEvent ?? CustomEventStub;
  }
  if (typeof g.PointerEvent === 'undefined') {
    g.PointerEvent = env?.CustomEvent ?? CustomEventStub;
  }
  if (typeof g.matchMedia === 'undefined') {
    g.matchMedia = (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    });
  }
  if (typeof g.getComputedStyle === 'undefined') {
    g.getComputedStyle = () => ({
      getPropertyValue: () => '',
    });
  }
  if (typeof g.requestAnimationFrame === 'undefined') {
    g.requestAnimationFrame = () => 0;
  }
  if (typeof g.cancelAnimationFrame === 'undefined') {
    g.cancelAnimationFrame = () => {};
  }
  if (g.window && typeof g.window.dispatchEvent === 'undefined') {
    g.window.dispatchEvent = () => true;
  }
  if (g.window && typeof g.window.addEventListener === 'undefined') {
    g.window.addEventListener = () => {};
  }
  if (g.window && typeof g.window.removeEventListener === 'undefined') {
    g.window.removeEventListener = () => {};
  }
}

/**
 * Execute a synchronous or asynchronous callback with SSR isolate globals installed,
 * restoring `globalThis` afterwards so no newly added keys leak into the host process.
 */
export function withScopedIsolateGlobals<T>(fn: (env: IsolateEnvironment) => T, env?: Partial<IsolateEnvironment>): T {
  const g = globalThis as any;
  const beforeGlobalKeys = new Set<PropertyKey>(Reflect.ownKeys(g));
  const existingWindow = g.window && typeof g.window === 'object' && g.window !== g ? g.window : null;
  const beforeWindowKeys = existingWindow ? new Set<PropertyKey>(Reflect.ownKeys(existingWindow)) : null;

  const restore = () => {
    for (const key of Reflect.ownKeys(g)) {
      if (!beforeGlobalKeys.has(key)) {
        try {
          delete g[key];
        } catch {}
      }
    }
    if (existingWindow && beforeWindowKeys) {
      for (const key of Reflect.ownKeys(existingWindow)) {
        if (!beforeWindowKeys.has(key)) {
          try {
            delete existingWindow[key];
          } catch {}
        }
      }
    }
  };

  const resolvedEnv: IsolateEnvironment = {
    ...createIsolateEnvironment(),
    ...env,
  };
  installIsolateGlobals(resolvedEnv);
  let isAsync = false;
  try {
    const result = fn(resolvedEnv);
    if (result !== null && (typeof result === 'object' || typeof result === 'function') && typeof (result as any).then === 'function') {
      isAsync = true;
      return (result as unknown as Promise<unknown>).finally(restore) as unknown as T;
    }
    return result;
  } finally {
    if (!isAsync) {
      restore();
    }
  }
}
