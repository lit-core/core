# Vite plugin configuration reference

`@lit-core/vite-plugin` unifies the `@lit-core` ahead-of-time compilation toolchain into a single, high-performance plugin for Vite and Rollup.

---

## Installation

```bash
pnpm add -D @lit-core/vite-plugin
```

---

## Basic configuration

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

## Options reference

### `cssFuse`
Enables cross-component CSS AST deduplication into shared constructable stylesheets.
- `threshold` (*number*, default: `2`): Minimum number of occurrences across components required to extract a CSS declaration block into a shared sheet.
- `include` (*string | string[]*): Glob pattern of files to analyze.
- `exclude` (*string | string[]*): Glob pattern of files to exclude.
- `applyInDev` (*boolean*, default: `false`): Whether to run CSS deduplication during Vite development server mode.

### `htmlFuse`
Enables cross-component static HTML and SVG fragment clustering.
- `threshold` (*number*, default: `2`): Minimum number of occurrences required to cluster a markup subtree.
- `minFragmentLength` (*number*, default: `15`): Minimum character length for candidate subtrees.

### `propsLower`
Enables native Rust lowering of Lit TypeScript decorators (`@property`, `@state`, `@query`) to static class `properties`.
- `include` / `exclude`: Glob patterns for target files.

### `elemProxy`
Enables deferred Custom Element proxy stubs for lazy class evaluation and reduced heap memory usage.
- `include` / `exclude`: Glob patterns for target element definitions.

### `htmlAot`
Enables ahead-of-time compilation of Lit `html` tagged templates into pre-parsed template descriptors.

### `cssMinifier` & `htmlMinifier`
Enables native Rust AST minification for embedded Lit `css` and `html` template literals.

---

## Related documentation

- [HMR and chunk boundary handling](hmr.md)
- [CSS deduplication architecture](../../css-fuse/docs/architecture.md)
- [Webpack plugin configuration](../../webpack-plugin/docs/configuration.md)
