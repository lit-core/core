# @lit-core/css-minifier

> Native Rust embedded CSS template minifier for Lit and Web Components, powered by `lightningcss` and `oxc`.

---

## Introduction

### What is it?

`@lit-core/css-minifier` is a high-speed compile-time minifier that parses and compresses CSS embedded inside Lit `css` tagged template literals ahead of time using `lightningcss` and `oxc`.

### Why does it exist?

Lit components define styles directly inside JavaScript source files:
```typescript
static styles = css`
  :host {
    display: inline-block;
    color: #ffffff;
    padding: 0px 16px;
  }
`;
```
Standard JavaScript minifiers (such as Terser or esbuild) treat template string contents as opaque text:
- They cannot perform CSS-specific minifications like property sorting, unit simplification, or color shortening.
- Embedded CSS comments, indentation, and redundant whitespace are preserved in production bundles.
- Across large design systems, uncompressed CSS inside template literals adds 8% to 15% unnecessary bloat to production chunks.

### How does it work?

`css-minifier` integrates CSS-aware compression into the build pipeline:
1. Locates Lit `css` tagged template expressions during AST traversal with `oxc`.
2. Extracts CSS declaration strings and parses them with `lightningcss`.
3. Performs syntax-level CSS minification: strips comments, shortens colors, simplifies dimension units, and collapses whitespace.
4. Rewrites the template literal quasis directly in the AST, emitting fully minified CSS without runtime overhead.

---

## Architecture

### Big picture

```mermaid
flowchart TD
    A["Lit component with css`...` tagged templates"] --> B["OXC AST visitor: locate CSS template literals"]
    B --> C["Extract CSS string fragments, preserving dynamic interpolations"]
    C --> D["Lightning CSS optimization pipeline: color shortening, unit simplification"]
    D --> E["Strip CSS comments & redundant whitespace"]
    E --> F["Rewrite template quasis directly in the AST"]
    F --> G["Optimized bundle with compact, syntax-minified CSS"]
```

### In-depth technical details

#### 1. Lightning CSS optimization passes
The minifier executes full CSS AST-level optimization:
- **Color shortening**: Converts verbose hex codes and named colors to their shortest equivalent (`#ffffff` to `#fff`, `rgba(0, 0, 0, 0)` to `transparent`).
- **Unit simplification**: Strips units from zero values (`0px` to `0`, `0rem` to `0`).
- **Whitespace compression**: Strips line breaks, indentation, and superfluous spaces around colons, braces, and semicolons.
- **Comment elimination**: Purges block and line comments.

#### 2. Interpolation safety
When templates include dynamic JavaScript expressions:
```typescript
css`:host { color: ${themeColor}; margin: 8px; }`
```
`css-minifier` minifies each static quasi independently while protecting dynamic expression boundary tokens, guaranteeing valid CSS syntax at runtime.

---

## Installation

```bash
pnpm add -D @lit-core/css-minifier
```

---

## Configuration and usage

### Via `@lit-core/vite-plugin`

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

### Via `@lit-core/webpack-plugin`

```javascript
const { LitCoreWebpackPlugin } = require('@lit-core/webpack-plugin');

module.exports = {
  plugins: [
    new LitCoreWebpackPlugin({
      cssMinifier: true,
    }),
  ],
};
```

### Programmatic API

```typescript
import { minifyCssTemplate } from '@lit-core/css-minifier';

const minified = minifyCssTemplate(`
  :host {
    display: inline-flex;
    color: #ffffff;
    margin: 0px 4px;
  }
`);
console.log(minified);
// Output: :host{display:inline-flex;color:#fff;margin:0 4px}
```

---

## Empirical performance

Evaluated across production design system component suites:

| Design system | Raw CSS template bytes | Minified CSS bytes | Byte reduction |
| :--- | ---: | ---: | ---: |
| Carbon Web Components | 794.2 KB | 728.5 KB | -8.3% |
| Spectrum Web Components | 412.8 KB | 379.0 KB | -8.2% |
| Web Awesome | 288.6 KB | 267.4 KB | -7.3% |
| Momentum Design | 520.1 KB | 476.3 KB | -8.4% |
| Material Web | 196.4 KB | 182.1 KB | -7.3% |

---

## Cross references

- CSS deduplication: [`@lit-core/css-fuse`](../css-fuse/README.md)
- HTML template minification: [`@lit-core/html-minifier`](../html-minifier/README.md)
- Bundler plugins: [`@lit-core/vite-plugin`](../vite-plugin/README.md) and [`@lit-core/webpack-plugin`](../webpack-plugin/README.md)
- Benchmark harness: [`@lit-core/benchmarks`](../benchmarks/README.md)

---

## License

MIT
