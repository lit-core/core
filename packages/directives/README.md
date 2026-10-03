# @lit-core/directives

Ahead-of-time (AOT) Lit directive lowering compiler pass and bundler optimization tool for Lit and Web Component applications.

---

## Overview

In enterprise Lit applications and design systems, built-in directives such as `classMap`, `styleMap`, `ifDefined`, `when`, and `repeat` appear across almost every component. At runtime, evaluating directives involves significant overhead:

- **Heap allocations on every render cycle**: Instantiates intermediate `DirectiveResult` sentinel wrapper objects and directive controller class instances.
- **Dynamic iteration and diffing**: Iterates object entries, checks previous sets/maps, and invokes reflective lifecycle hooks (`render()`, `update()`).
- **Vendor bundle weight**: Imports runtime directive base classes (`Directive`, `PartInfo`, directive helpers) into application vendor chunks.

`@lit-core/directives` eliminates this bottleneck by identifying and compiling all 21 built-in Lit directives ahead of time using native Rust and `oxc`.

---

## Key architectural features

- **Complete directive coverage**: Lowers all 21 built-in Lit directives (`classMap`, `styleMap`, `ifDefined`, `when`, `choose`, `map`, `join`, `range`, `guard`, `live`, `keyed`, `cache`, `repeat`, `templateContent`, `unsafeHTML`, `unsafeSVG`, `unsafeMathML`, `until`, `asyncAppend`, `asyncReplace`, and `ref`).
- **Zero runtime directive allocations**: Expression directives are compiled directly into fast primitive string concatenations, nullish coalescing, and native ternary expressions.
- **Automated import pruning**: Completely removes unused `lit/directives/*` and `lit-html/directives/*` imports from output modules, allowing bundlers to tree-shake directive classes from vendor bundles.
- **Minification safe and general purpose**: Employs semantic import resolution (`oxc_semantic`) to trace imports regardless of mangling, aliasing (`import { classMap as c }`), or namespace grouping (`import * as cm from 'lit/directives/class-map.js'`).
- **Deterministic AST construction**: Built exclusively with `oxc_allocator` and `AstBuilder` without fragile string splicing or re-parsing.

---

## Lowering examples

### `classMap` lowering

Input:
```ts
html`<button class=${classMap({ 'btn': true, 'btn--active': this.active })}>...</button>`
```

Compiled output:
```ts
html`<button class="${"btn" + (this.active ? " btn--active" : "")}">...</button>`
```

### `ifDefined` lowering

Input:
```ts
html`<input aria-label=${ifDefined(this.label)}>`
```

Compiled output:
```ts
html`<input aria-label=${this.label ?? nothing}>`
```

### `when` lowering

Input:
```ts
html`<div>${when(this.loading, () => html`<span>Loading...</span>`, () => html`<span>Ready</span>`)}</div>`
```

Compiled output:
```ts
html`<div>${this.loading ? html`<span>Loading...</span>` : html`<span>Ready</span>`}</div>`
```

---

## Installation

```bash
pnpm add -D @lit-core/directives
```

---

## Programmatic usage

```ts
import { transformDirectives } from '@lit-core/directives';

const result = transformDirectives(sourceCode, {
  filename: 'my-element.ts',
  sourcemap: true,
});

console.log(result.code);
console.log(result.loweredCount);
console.log(result.directivesUsed);
```

---

## License

MIT
