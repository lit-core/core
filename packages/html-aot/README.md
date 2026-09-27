# `@lit-core/html-aot`

> Ahead-of-time (AOT) template compilation for Lit components, eliminating runtime template preparation overhead.

`@lit-core/html-aot` pre-compiles Lit `html` tagged template literals into static `CompiledTemplateResult` descriptors with pre-calculated part offsets, eliminating runtime HTML parsing and template preparation.

---

## Key benefits

- **+35% to +38% first render speedup**: Bypasses runtime `innerHTML` parsing and DOM tree-walking during component hydration.
- **Spec-compliant Lit compiled template contract**: Integrates with Lit's native compiled template loader.
- **Zero runtime dependencies**: Generates static JavaScript descriptors.

---

## Installation

```bash
pnpm add -D @lit-core/html-aot
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
      htmlAot: true,
    }),
  ],
});
```

---

## Detailed documentation

- [AOT template compilation mechanics](docs/template-compilation.md)
- [HTML fragment clustering guide](../html-fuse/docs/fragment-clustering.md)
- [Empirical runtime performance benchmarks](../benchmarks/README.md)
