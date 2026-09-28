# `@lit-core/native`

> Ahead-of-time vanilla Web Component and micro-runtime compiler for Lit applications.

`@lit-core/native` compiles Lit components into pure native Web Components (`class extends HTMLElement`) with zero runtime dependencies for leaf components (Mode A) and a tiny 1.5 KB micro-runtime (`NativeElement`) for dynamic list components (Mode B).

---

## Key benefits

- **Zero Lit runtime dependencies**: Compiles leaf components to pure native `HTMLElement` custom elements with 0 KB Lit runtime overhead.
- **Micro-runtime for dynamic components**: Provides a lightweight ≤1.5 KB reactive base class (`NativeElement`) with batched microtask scheduling and keyed list reconciliation.
- **Ultra-fast native compilation**: Powered by Rust and `oxc` 0.151.0 for microsecond AST transforms.
- **Enterprise design system support**: Validated across all 349 components from IBM Carbon, Adobe Spectrum, Web Awesome, Cisco Momentum, and Google Material Web.

---

## Compiler modes

1. **Mode A (pure vanilla Custom Element)**:
   - Targets leaf components (buttons, icons, avatars, badges, toggles).
   - Generates pure `class extends HTMLElement` with `<template>` cloning, `adoptedStyleSheets`, and direct text node updates (`node.data = val`).
   - Completely removes all imports from `lit`, `lit-html`, and `reactive-element`.

2. **Mode B (directive lowering and micro-runtime)**:
   - Targets components containing dynamic template directives (`classMap`, `styleMap`, `ifDefined`, `guard`) or conditional logic.
   - Lowers high-level directives into zero-dependency inline JavaScript expressions, eliminating directive imports from `lit/directives/*`.
   - Enables tree-shaking of Lit directive modules, reducing bundle size while preserving full compatibility with `LitElement` lifecycle.

---

## Installation

```bash
pnpm add -D @lit-core/native
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
      native: true, // Enables Mode A and Mode B native compilation
    }),
  ],
});
```

Via `@lit-core/webpack-plugin`:
```javascript
import { LitCoreWebpackPlugin } from '@lit-core/webpack-plugin';

export default {
  plugins: [
    new LitCoreWebpackPlugin({
      native: true,
    }),
  ],
};
```

---

## Programmatic API

```typescript
import { classify, transformNative } from '@lit-core/native';

// Classify components in source code
const classifications = classify(sourceCode, { mode: 'auto' });
// [{ mode: 'vanilla', componentName: 'SimpleButton', tagName: 'simple-button' }]

// Compile components ahead of time
const result = transformNative(sourceCode, { mode: 'auto' });
console.log(result.code);
console.log(`Vanilla: ${result.vanillaCount}, Micro: ${result.microCount}`);
```

---

## Benchmark documentation

- [Native empirical benchmark results](../benchmarks/docs/native.md)
- [Monorepo benchmark overview](../benchmarks/README.md)
