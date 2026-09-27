# `@lit-core/html-minifier`

> Native Rust AOT AST HTML and SVG tagged template minifier for Lit and Web Components via OXC.

`@lit-core/html-minifier` parses `html\`...\`` and `svg\`...\`` tagged template literals at the AST level using `oxc`, stripping superfluous whitespace and HTML comments ahead of time while protecting literal boundaries (`<pre>`, `<code>`, `<textarea>`).

---

## Key features

- **AST string slice compression**: Minifies static string fragments without altering interpolation expressions, bindings, or event listeners.
- **-3.5% to -6.0% bundle reduction**: Eliminates formatting gaps and template whitespace before bundle minification.
- **High-speed Rust execution**: Runs via native NAPI-RS bindings with negligible build time impact.

---

## Installation

```bash
pnpm add -D @lit-core/html-minifier
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
      htmlMinifier: true,
    }),
  ],
});
```

Via `@lit-core/webpack-plugin`:
```javascript
const { LitCoreWebpackPlugin } = require('@lit-core/webpack-plugin');

module.exports = {
  plugins: [
    new LitCoreWebpackPlugin({
      htmlMinifier: true,
    }),
  ],
};
```

---

## Related documentation

- [HTML fragment clustering guide](../html-fuse/docs/fragment-clustering.md)
- [Ahead-of-time template compilation (`html-aot`)](../html-aot/docs/template-compilation.md)
- [html-minifier benchmark report](../benchmarks/docs/html-minifier.md)
- [Monorepo benchmark overview](../benchmarks/README.md)
