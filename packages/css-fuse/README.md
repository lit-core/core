# `@lit-core/css-fuse`

> Ahead-of-time (AOT) constructable stylesheet deduplication engine for Lit and Web Components, built with Rust and NAPI-RS.

`@lit-core/css-fuse` analyzes CSS rules across Lit components at the AST level, extracts duplicate declaration blocks into shared constructable stylesheet modules, and updates component `static styles` arrays while preserving cascade order, specificity, and tree-shaking boundaries.

---

## Key benefits

- **Zero HTML parsing**: Operates strictly on CSS AST trees without altering template literals or dynamic class bindings.
- **Cascade and specificity fidelity**: Shared declarations are prepended before local rules (`static styles = [sharedSheet, localOverrides]`), ensuring local overrides retain complete precedence.
- **Browser memory optimization**: Constructable stylesheets instantiate a single `CSSStyleSheet` in browser memory across all shadow roots.
- **Up to -54% bundle reduction**: Cuts repetitive resets, typography, and design tokens across production design systems.

---

## Installation

```bash
pnpm add -D @lit-core/css-fuse
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
      cssFuse: {
        threshold: 2,
      },
    }),
  ],
});
```

---

## Detailed documentation

- [Deduplication engine architecture](docs/architecture.md)
- [Shadow DOM scoping and safety audit](docs/scoping-audit.md)
- [Vite plugin configuration](../vite-plugin/docs/configuration.md)
- [Benchmark results](../benchmarks/README.md)
