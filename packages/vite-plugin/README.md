# `@lit-core/vite-plugin`

> Unified Vite and Rollup plugin integrating the `@lit-core` ahead-of-time compilation toolchain.

`@lit-core/vite-plugin` brings together cross-component CSS deduplication (`css-fuse`), HTML fragment clustering (`html-fuse`), decorator lowering (`props-lower`), template compilation (`html-aot`), deferred element proxies (`elem-proxy`), and native minification into a single, cohesive bundler plugin.

---

## Key benefits

- **Single configuration point**: Toggle or configure any `@lit-core` optimization tool from one import.
- **Rollup chunk scoping**: Guarantees shared constructable stylesheets respect Rollup code-splitting boundaries.
- **Fine-grained HMR**: Updates constructable stylesheets in browser memory without full page reloads.

---

## Installation

```bash
pnpm add -D @lit-core/vite-plugin
```

---

## Quick usage

```typescript
// vite.config.ts
import { defineConfig } from 'vite';
import { lit } from '@lit-core/vite-plugin';

export default defineConfig({
  plugins: [
    lit({
      cssFuse: true,
      propsLower: true,
      cssMinifier: true,
      htmlMinifier: true,
    }),
  ],
});
```

---

## Detailed documentation

- [Plugin options and configuration guide](docs/configuration.md)
- [Hot Module Replacement and chunk scoping](docs/hmr.md)
- [CSS deduplication architecture](../css-fuse/docs/architecture.md)
- [Monorepo benchmark suite](../benchmarks/README.md)
