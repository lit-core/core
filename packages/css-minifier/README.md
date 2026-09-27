# `@lit-core/css-minifier`

> Native Rust embedded CSS template minifier for Lit web components via OXC and Lightning CSS.

`@lit-core/css-minifier` performs ahead-of-time (AOT) minification on embedded CSS inside Lit `css` tagged template literals using `lightningcss` and `oxc`.

---

## Key features

- **Lightning CSS optimization**: Full CSS syntax minification including color shortening, unit simplification, property sorting, and comment removal.
- **Zero runtime overhead**: All minification executes during Vite or Webpack bundling.
- **Strict safety**: Operates strictly within standard CSS syntax rules without modifying selectors or scoping boundaries.

---

## Installation

```bash
pnpm add -D @lit-core/css-minifier
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
      cssMinifier: true,
    }),
  ],
});
```

---

## Related documentation

- [CSS deduplication architecture](../css-fuse/docs/architecture.md)
- [HTML template minification](../html-minifier/README.md)
- [Benchmark metrics](../benchmarks/README.md)
