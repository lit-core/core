# @lit-core/dom-paths

> Ahead-of-time (AOT) structural DOM path compiler eliminating TreeWalker mounting traversal for Lit and Web Components, built in Rust with `oxc`.

---

## Introduction

### What is it?

`@lit-core/dom-paths` is a compile-time transform that precomputes hierarchical child pointer paths (`[0, 2, 1]`) for all dynamic parts in Lit templates ahead of time, eliminating the runtime `TreeWalker` DOM traversal during component mounting.

### Why does it exist?

When a standard Lit component mounts in the browser:
1. It clones the HTML `<template>` element into the component's `ShadowRoot`.
2. It invokes `document.createTreeWalker()` to recursively walk through every single element and comment marker (`<!--lit-part-->`, `<!--lit-node-->`).
3. It associates template expression parts with the discovered DOM nodes.

In complex enterprise components with deeply nested DOM structures, this recursive JavaScript traversal represents the single largest CPU bottleneck during initial component mount.

### How does it work?

`dom-paths` precomputes part locations at build time:
1. Parses the template HTML structure and dynamic expression slots during compilation.
2. Generates an array of numeric child pointer paths from the root container to each dynamic part (e.g., `[0, 1, 2]` represents `root.childNodes[0].childNodes[1].childNodes[2]`).
3. Rewrites the component class to store these paths in a static field (`static __litPartPaths`).
4. At runtime, dynamic parts are resolved directly using native `.childNodes[i]` array lookups in nanoseconds via a <150-byte helper function, bypassing `document.createTreeWalker()` entirely.

---

## Architecture

```mermaid
flowchart TD
    A["Lit template with dynamic expressions: ${val}"] --> B["OXC parser: extract template quasis & expression slots"]
    B --> C["Compute hierarchical child index paths: [0, 2, 1]"]
    C --> D["Account for HTML whitespace normalization & text merging"]
    D --> E["Synthesize static __litPartPaths array on component class"]
    E --> F["Runtime component mount: direct .childNodes[i] pointer resolution"]
    F --> G["Zero TreeWalker traversal during initial mount"]
```

### Technical details

#### 1. Path precomputation algorithm

During compilation:
- Template string quasis are parsed into an AST representing the static DOM tree.
- Dynamic expression placeholders are marked as part target nodes.
- For each part, the compiler records the sequence of numeric child indices required to navigate from the root node to the target element or comment boundary.

#### 2. HTML whitespace normalization fidelity

Browsers normalize adjacent whitespace into single text nodes and merge consecutive text segments:
- The path compiler mirrors browser HTML parsing rules accurately.
- Accounts for text node coalescing to ensure that precomputed indices match the live cloned DOM structure across all modern browser engines.

#### 3. Runtime resolver helper

Target part nodes are resolved using direct pointer access:

```typescript
// Ultra-lightweight runtime helper (<150 bytes)
export function resolveNodeByPath(root: Node, path: number[]): Node {
  let current: Node = root;
  for (let i = 0; i < path.length; i++) {
    current = current.childNodes[path[i]];
  }
  return current;
}
```

This direct pointer dereference executes in nanoseconds, eliminating recursive function calls and walker iteration overhead.

---

## Installation

```bash
pnpm add -D @lit-core/dom-paths
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
      domPaths: true,
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
      domPaths: true,
    }),
  ],
};
```

### Programmatic API

```typescript
import { computeDomPaths, computeDomParts, transformDomPaths } from '@lit-core/dom-paths';

// Direct path computation
const paths = computeDomPaths(['<div><h1>Title</h1><p>Count: ', '</p><button @click=', '>+</button></div>']);
// Output: [[0, 1, 1], [0, 2]]

// Classified part descriptors (ElementAnchored, SoleTextChild, RangeAddressed)
const parts = computeDomParts(['<div><p>', '</p></div>']);

// Source code transformation
const result = transformDomPaths(sourceCode, {
  filename: 'counter.ts',
});
console.log(result.code);
```

---

## Cross references

- Template compilation: [`@lit-core/html-aot`](../html-aot/README.md)
- Event hoisting: [`@lit-core/event-hoist`](../event-hoist/README.md)
- Bundler plugins: [`@lit-core/vite-plugin`](../../bundlers/vite-plugin/README.md) and [`@lit-core/webpack-plugin`](../../bundlers/webpack-plugin/README.md)
- Benchmark harness: [`@lit-core/benchmarks`](../../internal/benchmarks/README.md)

---

## License

MIT
