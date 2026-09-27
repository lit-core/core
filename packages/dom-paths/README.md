# `@lit-core/dom-paths`

> Ahead-of-time structural DOM path compiler eliminating TreeWalker mounting traversal for Lit and Web Components.

`@lit-core/dom-paths` precomputes exact hierarchical child pointer paths (`[0, 2, 1]`) for dynamic parts in Lit templates ahead of time. It eliminates runtime TreeWalker DOM traversal during component mounting by resolving target part nodes via native `.childNodes[i]` pointers in nanoseconds.

---

## Key features

- **Eliminates runtime TreeWalker**: Replaces recursive DOM TreeWalker comment and element discovery with direct child pointer resolution.
- **Nanosecond part resolution**: Traverses native C++ `.childNodes[i]` pointers directly.
- **Tiny client footprint**: Provides an ultra-lightweight client helper (<150 bytes) for node resolution.
- **High-speed native parser**: Native Rust compiler pass powered by OXC, with a pure JavaScript fallback.
- **Full DOM fidelity**: Accounts for HTML whitespace normalization and text node merging.

---

## Installation

```bash
pnpm add -D @lit-core/dom-paths
```

## How it works

When a standard Lit component mounts, it clones a `<template>` into its ShadowRoot and executes `document.createTreeWalker` to traverse every single comment and element node looking for `<!--lit-part-->` and `<!--lit-node-->` markers. In complex components with deep DOM trees, this recursive JavaScript traversal is the largest CPU contributor to initial component mount latency.

`@lit-core/dom-paths` calculates the exact hierarchical numeric path from the root node to every dynamic part at build time:

```ts
// Source component
export class CounterComponent extends LitElement {
  render() {
    return html`
      <div>
        <h1>Title</h1>
        <p>Count: ${this.count}</p>
        <button @click=${this.inc}>+</button>
      </div>
    `;
  }
}
```

Transformed ahead of time to:

```ts
export class CounterComponent extends LitElement {
  static __litPartPaths = [
    [0, 1, 1], // Part 0 (count expression in <p>)
    [0, 2],    // Part 1 (attribute on button)
  ];

  render() {
    return html`
      <div>
        <h1>Title</h1>
        <p>Count: ${this.count}</p>
        <button @click=${this.inc}>+</button>
      </div>
    `;
  }
}
```

During component part preparation, dynamic part nodes are resolved directly via `resolveNodeByPath(this.shadowRoot, paths[i])` instead of executing `document.createTreeWalker`.

## Usage

### Direct path computation

```ts
import { computeDomPaths } from '@lit-core/dom-paths';

const paths = computeDomPaths([
  '<div>\n  <h1>Title</h1>\n  <p>Count: ',
  '</p>\n  <button @click=',
  '>+</button>\n</div>'
]);
// [[0, 1, 1], [0, 2]]
```

### Source code transformation

```ts
import { transformDomPaths } from '@lit-core/dom-paths';

const result = transformDomPaths(sourceCode, {
  filename: 'my-component.ts',
});
console.log(result.code);
```

### Bundler plugin integration

Via `@lit-core/vite-plugin`:

```typescript
import { defineConfig } from 'vite';
import { lit } from '@lit-core/vite-plugin';

export default defineConfig({
  plugins: [
    lit({
      domPaths: true,
    }),
  ],
});
```

---

## Related documentation

- [Ahead-of-time template compilation (`html-aot`)](../html-aot/docs/template-compilation.md)
- [ShadowRoot event delegation (`event-hoist`)](../event-hoist/README.md)
- [dom-paths benchmark report](../benchmarks/docs/dom-paths.md)
- [Monorepo benchmark overview](../benchmarks/README.md)
