# @lit-core/event-hoist

Ahead-of-time ShadowRoot event delegation compiler pass and bundler optimization for Lit and Web Component applications.

## Overview

In standard Lit components, declarative event bindings such as `@click=${this._onClick}` attach an individual native `addEventListener` to each DOM element when rendering template parts. In large component trees, data tables, and virtual lists, this pattern creates thousands of native C++ `EventListener` allocations in Blink/WebKit and closure allocations in V8, increasing mount latency and memory footprint.

`@lit-core/event-hoist` optimizes Lit templates ahead of time by:
1. Replaying bubbling child event bindings (`@click`, `@input`, `@change`, `@keydown`, etc.) with declarative action markers (`data-lh-<event>="${actionIndex}"`).
2. Synthesizing a single delegated event listener on the component's `ShadowRoot` during `connectedCallback` / `firstUpdated`.
3. Dispatching fired events through an instance lookup table using standard DOM event path traversal with shadow boundary encapsulation.

## Key features

- **Native Rust NAPI engine**: Ultra-fast AST parsing and code rewriting powered by OXC, with a general-purpose JavaScript fallback.
- **Selective bubbling hoisting**: Automatically hoists standard bubbling events (`click`, `input`, `change`, `keydown`, etc.) while preserving direct bindings for non-bubbling events (`focus`, `blur`, `scroll`).
- **Listener options safety**: Preserves direct element bindings when custom listener options are detected (`eventOptions`, `capture: true`, `passive: true`, `once: true`).
- **Encapsulation preservation**: Traverses the composed event path while verifying `getRootNode()`, ensuring delegated handlers never inadvertently trigger on action markers from nested Shadow DOM boundaries.
- **Propagation fidelity**: Fully respects `event.stopPropagation()` to stop bubbling and prevent higher-level delegated triggers.

---

## Installation

```bash
pnpm add -D @lit-core/event-hoist
```

---

## Quick usage

Via `@lit-core/vite-plugin`:

```typescript
import { defineConfig } from 'vite';
import { lit } from '@lit-core/vite-plugin';

export default defineConfig({
  plugins: [
    lit({
      eventHoist: true,
    }),
  ],
});
```

Via `@lit-core/webpack-plugin`:

```javascript
const { LitCoreWebpackPlugin } = require('@lit-core/webpack-plugin');

module.exports = {
  plugins: [
    new LitCoreWebpackPlugin({
      eventHoist: true,
    }),
  ],
};
```

---

## Architecture and cross references

- Monorepo benchmark overview: [benchmarks README](../benchmarks/README.md)
- Dedicated benchmark report: [event-hoist benchmark docs](../benchmarks/docs/event-hoist.md)
- Companion packages:
  - [`@lit-core/vite-plugin`](../vite-plugin/README.md)
  - [`@lit-core/webpack-plugin`](../webpack-plugin/README.md)
  - [`@lit-core/elem-proxy`](../elem-proxy/README.md)
  - [`@lit-core/html-aot`](../html-aot/README.md)

## License

MIT
