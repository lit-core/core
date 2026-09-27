# `@lit-core/html-fuse`

> Ahead-of-time (AOT) static HTML and SVG template fragment deduplication and clustering engine for Lit, built with Rust and NAPI-RS.

`@lit-core/html-fuse` parses static HTML and SVG subtrees inside Lit `html` and `svg` template literals, clusters identical subtrees into shared virtual template modules, and leverages `lit-html`'s frozen `TemplateStringsArray` caching to eliminate duplicate `innerHTML` parsing in the browser.

---

## Key benefits

- **Zero runtime overhead**: Generates native Lit template constants ahead of time.
- **Single-parse innerHTML caching**: Browsers parse shared subtrees once into template elements and reuse instances.
- **Native Rust AST analysis**: High-speed fragment clustering powered by `oxc`.

---

## Installation

```bash
pnpm add -D @lit-core/html-fuse
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
      htmlFuse: {
        threshold: 2,
        minFragmentLength: 15,
      },
    }),
  ],
});
```

---

## Detailed documentation

- [Static fragment clustering guide](docs/fragment-clustering.md)
- [Ahead-of-time template compilation (`html-aot`)](../html-aot/docs/template-compilation.md)
- [html-fuse benchmark report](../benchmarks/docs/html-fuse.md)
- [Monorepo benchmark overview](../benchmarks/README.md)
