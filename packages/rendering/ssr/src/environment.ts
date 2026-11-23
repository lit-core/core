/**
 * Pure V8 Isolate Minimal Environment (ISME) for @lit-core/ssr.
 *
 * Stateless stubs for HTMLElement, customElements, CustomEvent, and CSSStyleSheet with no dependency
 * on node:vm. `createIsolateEnvironment()` returns the stubs without touching globals;
 * `installIsolateGlobals()` only fills globals that are still undefined (including window, aliased to
 * globalThis) and never replaces existing ones. The implementation lives in `environment/`.
 */
export * from './environment/aria.js';
export * from './environment/constructable.js';
export * from './environment/document.js';
export * from './environment/events.js';
export * from './environment/html-element.js';
export * from './environment/isolate.js';
export * from './environment/registry.js';
export * from './environment/shadow-root.js';
