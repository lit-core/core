# `@lit-core/dirty-mask`

> Ahead-of-time property-to-part dependency bitmasking compiler pass and bundler optimization for Lit and Web Components.

`@lit-core/dirty-mask` solves reactive template diffing overhead by tracing AST dependencies between reactive properties and expressions in Lit `html` templates, computing a 32-bit `dirtyMask` at runtime, and short-circuiting unchanged template expressions with Lit's native `noChange` sentinel symbol.

---

## Key benefits

- **Zero redundant part diffs**: Skips part comparison and DOM mutation when associated properties have not changed.
- **Microtask update acceleration**: Reduces CPU cycles during component re-renders and property mutations.
- **Spec-compliant short-circuiting**: Leverages Lit's built-in `noChange` sentinel without modifying Lit runtime internals.
- **Conservative dependency analysis**: Unknown expressions, external variables, or complex function calls fall back safely to full evaluation.

---

## How it works

In standard Lit applications, updating any reactive property (`this.count++`) triggers a microtask update. During `update()`, Lit re-evaluates all template expressions in `render()`, allocates an array of values, and performs value comparisons across every part. In components with 10 to 30 expressions, single-property mutations incur redundant expression re-evaluations and diffing overhead.

`@lit-core/dirty-mask` solves this ahead of time:
1. Traces AST dependencies between reactive properties (`@property`, `@state`, or `static properties`) and expressions in `html` tagged templates.
2. Assigns each reactive property an incremental bit index and each template expression a dependency bitmask.
3. Rewrites `update(changedProperties)` to compute a 32-bit `dirtyMask` integer from Lit's native `changedProperties` map.
4. Rewrites template expressions to short-circuit using Lit's native `noChange` sentinel symbol: `${(this.__litDirtyMask & mask) ? (originalExpression) : noChange}`. When Lit receives `noChange`, it immediately skips the entire part comparison and DOM mutation.
5. Non-reactive fields, external variables, or complex function calls with potential side effects receive a fallback mask of `-1`, ensuring safe, full evaluation.

---

## Installation

```bash
pnpm add -D @lit-core/dirty-mask
```

---

## Quick usage

### Vite plugin

```typescript
import { defineConfig } from 'vite';
import { lit } from '@lit-core/vite-plugin';

export default defineConfig({
  plugins: [
    lit({
      dirtyMask: true,
    }),
  ],
});
```

### Webpack plugin

```javascript
const { LitCoreWebpackPlugin } = require('@lit-core/webpack-plugin');

module.exports = {
  plugins: [
    new LitCoreWebpackPlugin({
      dirtyMask: true,
    }),
  ],
};
```

### Direct API

```typescript
import { transformDirtyMask } from '@lit-core/dirty-mask';

const result = transformDirtyMask(sourceCode, {
  filename: 'my-component.ts',
});

console.log(result.code);
```

---

## Related documentation

- [Ahead-of-time reactive expression auto-memoization (`memoize`)](../memoize/README.md)
- [Ahead-of-time template compilation (`html-aot`)](../html-aot/docs/template-compilation.md)
- [dirty-mask benchmark report](../benchmarks/docs/dirty-mask.md)
- [Monorepo benchmark overview](../benchmarks/README.md)
