# @lit-core/resumable

> Zero-JavaScript SSR and interaction-driven runtime resumption for Lit and Web Component applications.

---

## Introduction

### What is it?

`@lit-core/resumable` is an execution architecture for Lit applications that renders native Declarative Shadow DOM (DSD) on the server and defers downloading and evaluating component JavaScript until a user actually interacts with a component.

### Why does it exist?

Standard Server-Side Rendering (SSR) for Web Components solves visual paint latency but leaves initial JavaScript execution bottlenecks unsolved:
- Traditional hydration requires downloading, parsing, and evaluating every single component class upfront on page load.
- Lit must traverse the server-rendered DOM tree to re-discover template parts and re-attach reactive state.
- On mobile devices and slower networks, this upfront hydration causes high Total Blocking Time (TBT) and delays Time to Interactive (TTI), even if the user never interacts with the majority of components on the page.

### How does it work?

`resumable` replaces full upfront hydration with interaction-driven resumption:
1. **Server side**: Renders components into native Declarative Shadow DOM (`<template shadowrootmode="open">`) and serializes reactive property values into a compact snapshot tag (`<script type="lit/state">`).
2. **Zero initial JS boot**: The browser renders complete, styled Shadow DOM natively with zero component JavaScript downloaded or evaluated on initial load.
3. **Micro-loader**: An inline ~1.2 KB micro-loader in `<head>` listens for interaction events (`click`, `keydown`, `input`) during the capture phase.
4. **On-demand resumption**: When an interaction occurs, the micro-loader loads the specific component chunk, adopts the existing Shadow DOM without recreating DOM nodes, restores reactive properties, and replays the buffered event in FIFO order.

---

## Architecture

### Big picture

```mermaid
sequenceDiagram
    autonumber
    participant Server as SSR Server
    participant Browser as Browser HTML Parser
    participant Loader as Micro-Loader (~1.2 KB)
    participant Component as Component Chunk (Lazy)

    Server->>Browser: HTML with Declarative Shadow DOM + <script type="lit/state">
    Note over Browser: Instant visual render via DSD; Zero component JS downloaded
    Browser->>Loader: User interacts (e.g. click event)
    Loader->>Loader: Intercept event during capture phase & buffer in queue
    Loader->>Component: Dynamically import component chunk
    Component->>Browser: Adopt existing shadowRoot without wiping innerHTML
    Component->>Component: Restore state from snapshot & bind event listeners
    Loader->>Component: Replay buffered user event in FIFO order
```

### In-depth technical details

#### 1. Server-side rendering (`@lit-core/resumable/server`)
- Emits standard Declarative Shadow DOM (`<template shadowrootmode="open">`) supported natively in all modern browsers.
- Serializes reactive property states into a minified `<script type="lit/state">` tag inside the shadow root.
- Produces zero layout shifts and instant Largest Contentful Paint (LCP).

#### 2. Client-side micro-loader (`@lit-core/resumable/client`)
- Extremely lightweight (~1.2 KB) standalone script inlined directly in `<head>`.
- Intercepts user interactions at the `window` level during capture phase.
- Extracts un-upgraded custom element tags from `event.composedPath()`.
- Maps custom element tags to their respective JavaScript chunks via an ahead-of-time manifest.

#### 3. Hydration-free resumption adapter
When the component chunk loads:
- **No DOM destruction**: Unlike standard hydration routines that re-render or recreate template elements, the adapter attaches to the existing live `this.shadowRoot`.
- **State restoration**: Deserializes property values from `<script type="lit/state">` and removes the state script tag.
- **Event replay**: Buffers incoming interactions and dispatches synthetic events to the original targets once the custom element definition is registered.

---

## Installation

```bash
pnpm add -D @lit-core/resumable
```

---

## Configuration and usage

### Via `@lit-core/vite-plugin`

```typescript
import { defineConfig } from 'vite';
import { LitCoreVitePlugin } from '@lit-core/vite-plugin';

export default defineConfig({
  plugins: [
    LitCoreVitePlugin({
      resumable: {
        preloadOnHover: true,
      },
    }),
  ],
});

```

### Via `@lit-core/webpack-plugin`

```javascript
const { LitCoreWebpackPlugin } = require('@lit-core/webpack-plugin');

module.exports = {
  plugins: [
    new LitCoreWebpackPlugin({
      resumable: {
        preloadOnHover: true,
      },
    }),
  ],
};
```

---

## Empirical performance

Evaluated across production design system component suites (from `packages/benchmarks/results/manifest.json`) and full SSR interaction-driven hydration scenarios:

### Production component suites (`results/manifest.json`)

| Design system | Baseline mount latency | With `@lit-core/resumable` | Mount acceleration | Reactive update speedup | Script eval latency |
| :--- | ---: | ---: | ---: | ---: | ---: |
| Carbon Web Components | 96.0 ms | 44.6 ms | +53.5% | +50.0% (2.3 ms vs 4.6 ms) | 3.4 ms (vs 4.4 ms, +22.7%) |
| Spectrum Web Components | 52.3 ms | 24.1 ms | +53.9% | +14.3% (1.8 ms vs 2.1 ms) | 10.7 ms (vs 10.5 ms) |
| Web Awesome | 41.0 ms | 34.0 ms | +17.1% | +12.5% (1.4 ms vs 1.6 ms) | 3.3 ms (vs 6.2 ms, +46.8%) |
| Momentum Design | 39.6 ms | 18.8 ms | +52.5% | +36.4% (0.7 ms vs 1.1 ms) | 4.1 ms (vs 4.3 ms, +4.7%) |
| Material Web | 45.1 ms | 18.8 ms | +58.3% | +28.6% (1.5 ms vs 2.1 ms) | 5.8 ms (vs 6.8 ms, +14.7%) |

### Dynamic SSR resumption scenario (`ssr` benchmark)

| Metric | Standard SSR with Lit hydration | With `@lit-core/resumable` | Improvement |
| :--- | ---: | ---: | ---: |
| Initial JavaScript downloaded on boot | 420.5 KB | 1.2 KB | -99.6% |
| Total Blocking Time (TBT) | 340 ms | 4 ms | -98.8% |
| First Input Delay (FID) / INP | 65 ms | 12 ms | -81.5% |
| DOM element recreation | Recreated on hydrate | 0 nodes recreated | Zero layout shift |

---

## Cross references

- Deferred Custom Element proxies: [`@lit-core/elem-proxy`](../elem-proxy/README.md)
- Dead code elimination: [`@lit-core/tag-shake`](../tag-shake/README.md)
- Bundler plugins: [`@lit-core/vite-plugin`](../vite-plugin/README.md) and [`@lit-core/webpack-plugin`](../webpack-plugin/README.md)
- Benchmark harness: [`@lit-core/benchmarks`](../benchmarks/README.md)

---

## License

MIT
