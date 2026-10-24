import { DOM_PATHS_SOURCE } from '@lit-core/dom-paths';
import { NATIVE_RUNTIME_SOURCE } from '@lit-core/native';
import { RESUMABLE_ADAPTER_SOURCE } from '@lit-core/resumable';

export const SSR_RUNTIME_SOURCE = "export { render, renderToStream, renderToString, collectResult, createIsolateEnvironment, installIsolateGlobals } from '@lit-core/ssr';";

export const ISLANDS_LOADER_SOURCE = `(function () {
  const loaded = new Set();
  function hydrate(el) {
    const tag = el.localName;
    if (loaded.has(tag)) return;
    loaded.add(tag);
    const manifest = typeof window !== 'undefined' ? (window.__LIT_ISLANDS_MANIFEST__ || window.__LIT_RESUMABLE_MANIFEST__) : undefined;
    const src = el.getAttribute('data-island-src') || (manifest && manifest[tag]);
    if (!src) return;
    import(src).catch(() => {});
  }
  if (typeof IntersectionObserver !== 'undefined') {
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          observer.unobserve(entry.target);
          hydrate(entry.target);
        }
      }
    });
    document.querySelectorAll('[data-island="visible"]').forEach((el) => observer.observe(el));
  }
  const idle = typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function'
    ? (cb) => window.requestIdleCallback(cb)
    : (cb) => setTimeout(cb, 1);
  document.querySelectorAll('[data-island="idle"]').forEach((el) => {
    idle(() => hydrate(el));
  });
  const interactionEvents = ['pointerdown', 'keydown', 'focusin'];
  function onInteraction(e) {
    const target = e && e.target;
    const island = target && typeof target.closest === 'function' ? target.closest('[data-island="interaction"]') : null;
    if (island) {
      hydrate(island);
      interactionEvents.forEach((type) => window.removeEventListener(type, onInteraction, true));
    }
  }
  interactionEvents.forEach((type) => window.addEventListener(type, onInteraction, { capture: true, passive: true }));
  document.querySelectorAll('[data-island="load"]').forEach((el) => hydrate(el));
})();`;

export const VIRTUAL_LIT_CORE_MODULES: Record<string, string> = {
  'resumable-adapter': RESUMABLE_ADAPTER_SOURCE,
  resumable: RESUMABLE_ADAPTER_SOURCE,
  'native-runtime': NATIVE_RUNTIME_SOURCE,
  native: NATIVE_RUNTIME_SOURCE,
  reconciler: NATIVE_RUNTIME_SOURCE,
  'dom-paths': DOM_PATHS_SOURCE,
  'ssr-runtime': SSR_RUNTIME_SOURCE,
  'islands-loader': ISLANDS_LOADER_SOURCE,
};

export function getVirtualLitCoreModule(subpath: string): string | undefined {
  const clean = subpath
    .split('?')[0]
    .replace(/^\/+/, '')
    .replace(/\.[jt]s$/, '');
  return VIRTUAL_LIT_CORE_MODULES[clean];
}
