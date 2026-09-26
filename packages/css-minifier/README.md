# @lit-core/css-minifier

High-performance native Rust embedded CSS template minifier for Lit web components via OXC and Lightning CSS.

## Features

- **Lightning CSS Integration**: Minifies embedded CSS inside `css\`...\`` tagged template literals using native Rust Lightning CSS with `minify: true`.
- **Advanced Optimizations**:
  - Color format normalization and shortening (e.g. `rgb(255, 0, 0)` -> `red` / `#f00`)
  - Redundant unit removal (`0px` -> `0`)
  - Duplicate property elimination
  - `calc()` compile-time simplification
  - Declarations sorting and whitespace stripping
- **Zero Runtime Overhead**: All minification occurs ahead-of-time (AOT) during the Vite build pipeline.
- **Completely Safe**: Operates strictly within standard CSS syntax rules and never alters selectors, scoping, or Shadow DOM boundaries.

## Usage

```ts
import { minifyEmbeddedCss } from '@lit-core/css-minifier';

const result = minifyEmbeddedCss(sourceCode, {
  sourcemap: true,
  filename: 'my-element.ts',
});

console.log(result.code);
console.log(`Minified ${result.minifiedTemplates} templates, saved ${result.bytesSaved} bytes`);
```
