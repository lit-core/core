# @lit-core/dirty-mask

Ahead-of-time property-to-part dependency bitmasking compiler pass and bundler optimization for Lit and Web Components.

## Overview

In standard Lit applications, updating any reactive property (`this.count++`) triggers a microtask update. During `update()`, Lit re-evaluates all template expressions in `render()`, allocates an array of values, and performs value comparisons across every part. In components with 10 to 30 expressions, single-property mutations incur redundant expression re-evaluations and diffing overhead.

`@lit-core/dirty-mask` solves this ahead of time:
- Traces AST dependencies between reactive properties (`@property`, `@state`, or `static properties`) and expressions in `html` tagged templates.
- Assigns each reactive property an incremental bit index and each template expression a dependency bitmask.
- Rewrites `update(changedProperties)` to compute a 32-bit `dirtyMask` integer from Lit's native `changedProperties` map.
- Rewrites template expressions to short-circuit using Lit's native `noChange` sentinel symbol: `${(this.__litDirtyMask & mask) ? (originalExpression) : noChange}`. When Lit receives `noChange`, it immediately skips the entire part comparison and DOM mutation.
- Non-reactive fields, external variables, or complex function calls with potential side effects receive a fallback mask of `-1`, ensuring safe, full evaluation.

## Installation

```bash
pnpm add -D @lit-core/dirty-mask
```

## Usage

### Direct API

```typescript
import { transformDirtyMask } from '@lit-core/dirty-mask';

const result = transformDirtyMask(sourceCode, {
  filename: 'my-component.ts',
});

console.log(result.code);
```

### Vite plugin

```typescript
import { lit } from '@lit-core/vite-plugin';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [
    lit({
      dirtyMask: true,
    }),
  ],
});
```

### Webpack plugin

```typescript
import { LitWebpackPlugin } from '@lit-core/webpack-plugin';

export default {
  plugins: [
    new LitWebpackPlugin({
      dirtyMask: true,
    }),
  ],
};
```
