# @lit-core/css-fuse

> Ahead-of-time (AOT) cross-component CSS AST deduplication engine for Lit and Web Components, built in Rust with `oxc` and `lightningcss`.

---

## Introduction

### What is it?

`@lit-core/css-fuse` is a compile-time optimization engine that deduplicates CSS declaration blocks across Web Component boundaries. It extracts recurring rules into shared constructable stylesheet modules and rewrites component `static styles` declarations ahead of time.

### Why does it exist?

Web Components enforce strict style encapsulation via the Shadow DOM. Because document-level stylesheets and utility classes cannot pierce shadow roots, component libraries must package shared design tokens, reset rules, focus indicators, and typography inside every individual component.

In large enterprise design systems like IBM Carbon Web Components, this encapsulation model creates severe style redundancy:
- Over 50% of the raw bundle size across components consists of repeated CSS declarations.
- At runtime, the browser parses identical CSS rules repeatedly and allocates separate stylesheet objects for each custom element definition.
- Traditional bundler-level deduplication fails because styles are embedded inside JavaScript tagged template literals (`css`\`...\``) or array calls.

### How does it work?

`css-fuse` intervenes during the build phase (via Vite, Rollup, or Webpack):
1. Traverses component source files at the AST level using `oxc`.
2. Locates Lit `static styles` definitions and parses embedded CSS rules using `lightningcss`.
3. Normalizes and hashes every rule to build a global frequency index of identical declarations.
4. Clusters rules appearing across multiple components into shared virtual modules (`virtual:css-fuse/*`).
5. Rewrites the component `static styles` array to prepend the shared constructable sheet before local overrides: `static styles = [sharedSheet, localOverrides]`.
6. In the browser, each shared sheet instantiates a single `CSSStyleSheet` object shared across all component shadow roots in memory.

---

## Architecture

```mermaid
flowchart TD
    A["Lit component sources (.ts / .js)"] --> B["OXC JavaScript AST visitor"]
    B --> C["Extract static styles: css`...` & css([...])"]
    C --> D["Lightning CSS rule canonicalization & hashing"]
    D --> E["Cross-module frequency index & cluster analysis"]
    E --> F["Extract shared rules into virtual:css-fuse/*"]
    F --> G["Rewrite static styles = [sharedSheet, localOverrides]"]
    G --> H["Browser runtime: single CSSStyleSheet shared across shadow roots"]
```

### Technical details

#### 1. AST extraction with `oxc`

The compiler inspects JavaScript and TypeScript files using `oxc` 0.151.0:
- Resolves Lit imports semantically using `oxc_semantic` to trace identifiers regardless of mangling or aliasing (`import { css as c } from 'lit'`).
- Matches both tagged template expressions (`static styles = css\`...\``) and call expressions (`static styles = css([styles1, styles2])`, common in compiled SCSS outputs).
- Preserves template expression interpolation bindings if present, extracting only pure CSS rules.

#### 2. Rule canonicalization and hashing with `lightningcss`

Extracted stylesheet strings are parsed through `lightningcss`:
- Normalizes shorthand declarations and formats values deterministically.
- Sorts CSS declarations within each rule block into a canonical order.
- Generates a 64-bit hash fingerprint for each `(selector, declaration_block)` pair.

#### 3. Cross-module clustering and frequency index

The engine builds an in-memory graph mapping rule hash fingerprints to the components that contain them:
- Rules occurring at or above the configured `threshold` (default: `2`) become candidates for extraction.
- Identical sharing patterns (rules shared across the exact same set of components) are consolidated into a single virtual module.
- Candidate clusters are evaluated against a net savings formula:

$$\text{net savings} = \sum (\text{rule bytes} \times (\text{occurrences} - 1)) - \text{virtual module import overhead}$$

If the total bytes saved do not exceed the module overhead (~60 bytes per import), the rules remain local to the component.

#### 4. Cascade, specificity, and safety invariants

`css-fuse` strictly enforces Shadow DOM cascade semantics:
- **Selector preservation**: Selectors are never mangled, combined, or shortened. `:host`, `:host(...)`, `:host-context(...)`, and `::slotted(...)` retain their exact specificity weight.
- **Precedence ordering**: Shared constructable stylesheets are always prepended before local component overrides:

  ```javascript
  static styles = [_fused_sheet_a1b2, css`:host { display: inline-flex; }`];
  ```

  Because CSS rules with identical specificity resolve according to source order, this guarantees that local component overrides always take precedence over shared declarations.
- **Chunk boundary scoping**: Virtual modules are scoped to the smallest common ancestor chunk in the bundler's module graph. Shared styles from lazy-loaded routes never leak into entry chunks or create circular dependency cycles.

---

## Installation

```bash
pnpm add -D @lit-core/css-fuse
```

---

## Configuration and usage

### Via `@lit-core/vite-plugin`

```typescript
import { defineConfig } from 'vite';
import { LitCoreVitePlugin } from '@lit-core/vite-plugin';

export default defineConfig({
  plugins: [
    LitCoreVitePlugin({
      cssFuse: {
        threshold: 2,
        applyInDev: false,
      },
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
      cssFuse: {
        threshold: 2,
      },
    }),
  ],
};
```

### Programmatic API

```typescript
import { fuse, analyze, auditScoping } from '@lit-core/css-fuse';

const result = fuse({
  include: ['src/**/*.ts'],
  threshold: 2,
  minSavings: 200,
});

for (const sheet of result.fusedSheets) {
  console.log(`Generated shared sheet: ${sheet.id} (${sheet.rulesCount} rules)`);
}

for (const file of result.rewrittenFiles) {
  console.log(`Rewritten component: ${file.filePath}`);
}
```

### Options reference

| Option | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `threshold` | `number` | `2` | Minimum number of component occurrences required to cluster a CSS rule |
| `minSavings` | `number` | `200` | Minimum net byte savings required after accounting for module import overhead |
| `include` | `string[]` | `['packages/components/**/src/**/*.ts', 'src/**/*.ts']` | Glob patterns of source files to include in deduplication analysis |
| `exclude` | `string[]` | `['**/*.test.ts', '**/*.spec.ts', '**/node_modules/**', '**/dist/**']` | Glob patterns of source files to exclude |
| `outputDir` | `string` | `'.fused'` | Directory for generated fused sheet files when emitted to disk |
| `virtualImports` | `boolean` | `false` | Emit `virtual:css-fuse/*` module specifiers instead of relative paths |
| `scopingAudit` | `boolean` | `true` | Enable Shadow DOM scoping and contract audit diagnostics (via bundler plugin) |
| `applyInDev` | `boolean` | `false` | Whether to run CSS deduplication during local development server mode (via bundler plugin) |

---

## Cross references

- Companion transform: [`@lit-core/css-minifier`](../css-minifier/README.md)
- Bundler plugins: [`@lit-core/vite-plugin`](../../bundlers/vite-plugin/README.md) and [`@lit-core/webpack-plugin`](../../bundlers/webpack-plugin/README.md)
- Benchmark harness: [`@lit-core/benchmarks`](../../internal/benchmarks/README.md)

---

## License

MIT
