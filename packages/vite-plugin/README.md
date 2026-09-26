# @lit-core/vite-plugin

> Official Vite and Rollup plugin for Lit and Web Components (@lit-core), featuring AOT Constructable Stylesheet Deduplication (`css-fuse`) and component optimization toolchains.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

---

## Overview

`@lit-core/vite-plugin` is the official Vite integration for the `@lit-core` ecosystem. It connects Lit component analysis, AST-driven transformations, and CSS deduplication directly into Vite's module graph.

Its primary built-in capability is **`css-fuse`**: an Ahead-of-Time AST-driven engine that extracts identical CSS declaration blocks across Lit components into shared constructable stylesheet modules (`new CSSStyleSheet()` / `css\`...\``), strictly preserving cascade ordering and chunk boundaries.

### Key Capabilities

- **Configurable Feature Set**: Enable or configure features like `cssFuse` independently (`cssFuse: true`, `cssFuse: false`, or custom options object). Designed for expanding Lit toolchains.
- **Zero Monolithic Global Stylesheets**: Shared rules are split into deterministic, hash-identified modules (`virtual:css-fuse/_fused_<id>.js`).
- **Module Graph & Chunk Alignment**: Each component imports only the exact shared stylesheets it participates in. Rollup co-locates shared sheets into their respective output chunks, ensuring components in lazy-loaded routes never leak shared rules into the entry bundle.
- **Fast HMR in Dev**: Intercepts component updates in `handleHotUpdate`, re-evaluates local CSS, and invalidates affected virtual stylesheet nodes in Vite's module graph without forcing a full-page reload.
- **Strict Cascade Preservation**: Prepends shared sheets before local overrides in `static styles = [sharedSheet, localStyles]`, allowing local component overrides to win without specificity hacks.

---

## Installation

```bash
# Using pnpm
pnpm add -D @lit-core/vite-plugin @lit-core/css-fuse

# Using npm
npm install --save-dev @lit-core/vite-plugin @lit-core/css-fuse
```

---

## Usage

In your `vite.config.ts` (or `vite.config.js`):

```typescript
import { defineConfig } from 'vite';
import lit from '@lit-core/vite-plugin';

export default defineConfig({
  plugins: [
    lit({
      // Configure css-fuse AST deduplication (enabled by default)
      cssFuse: {
        include: ['src/components/**/*.ts'],
        threshold: 2,
        applyInDev: true,
        scopingAudit: true,
      },
    }),
  ],
});
```

### Standalone Plugin Import

If you only want the `css-fuse` plugin directly:

```typescript
import { defineConfig } from 'vite';
import { cssFuse } from '@lit-core/vite-plugin';

export default defineConfig({
  plugins: [
    cssFuse({
      include: ['src/components/**/*.ts'],
      threshold: 2,
    }),
  ],
});
```

---

## How It Works in Vite & Rollup

### 1. Build Phase (`buildStart` & `transform`)
During `vite build`, the plugin:
1. Runs an in-memory pass of `@lit-core/css-fuse` across all matched component files.
2. Registers generated shared stylesheets in an in-memory virtual module store.
3. In `transform(code, id)`, intercepts each component module and replaces it with the deduplicated version:
   - Prepends `import { _fused_abc123 } from 'virtual:css-fuse/_fused_abc123.js';`
   - Replaces `static styles = css\`...\`` with `static styles = [_fused_abc123, css\`...remaining overrides...\`];`

### 2. Virtual Module Resolution (`resolveId` & `load`)
Virtual stylesheets are resolved and served seamlessly:
```
Import:   virtual:css-fuse/_fused_abc123.js
Resolved: \0virtual:css-fuse/_fused_abc123.js
Load:     export const _fused_abc123 = css`...shared rules...`;
```

### 3. Chunk Isolation & Tree-Shaking
Because each component only imports the specific virtual sheets it uses:
- If Component A and B share `_fused_1`, and both live in the main entry, Rollup includes `_fused_1` in the main chunk.
- If Component C and D share `_fused_2`, and are only imported in a dynamic `import('./route-admin.js')`, Rollup bundles `_fused_2` into the admin chunk.
- `_fused_2` is **never included in the entry bundle**, guaranteeing zero code bloat for unvisited routes.

### 4. Development Server & Hot Module Replacement (`handleHotUpdate`)
In `vite dev`:
- When you edit a component's styles, the plugin re-runs extraction.
- It detects which virtual sheets changed and invalidates them via `server.moduleGraph.invalidateModule()`.
- The component re-adopts its updated styles in the browser without tearing down DOM state or triggering a full page reload.

---

## Configuration Options

### `LitPluginOptions`

| Option | Type | Default | Description |
|---|---|---|---|
| `cssFuse` | `boolean \| CssFuseOptions` | `true` | Enable or configure CSS AST deduplication and constructable stylesheet sharing. Pass `false` to disable. |

### `CssFuseOptions`

| Option | Type | Default | Description |
|---|---|---|---|
| `include` | `string[]` | `['packages/components/**/src/**/*.ts', 'src/**/*.ts']` | Glob patterns for component source files |
| `exclude` | `string[]` | `['**/*.test.ts', '**/*.spec.ts', '**/node_modules/**', '**/dist/**']` | Glob patterns to exclude |
| `threshold` | `number` | `2` | Minimum components sharing a rule to trigger extraction |
| `outputDir` | `string` | `'.fused'` | Directory name for virtual module identification |
| `scopingAudit` | `boolean` | `true` | Log W3C `::slotted()` and design contract violations to terminal |
| `applyInDev` | `boolean` | `false` | Enable deduplication during `vite dev` (when `false`, runs fast scoping audit only) |

---

## Benchmark: Web Awesome Component Suite

We tested `@lit-core/vite-plugin` against the complete suite of **73 custom elements** from `@awesome.me/webawesome` (v3.14.0) bundled with standard Vite production settings.

Benchmarks are maintained in the [`@lit-core/benchmarks`](../benchmarks/) workspace.

### Run Benchmark

```bash
pnpm --filter @lit-core/benchmarks run benchmark:webawesome
```

### Benchmark Results

```
===============================================================
⚡ WEB AWESOME FULL BUNDLE DEDUPLICATION BENCHMARK
===============================================================
Detected components: 73 Web Awesome custom elements

• Total CSS rules scanned:               1,001 rules
• Deduplicated rules:                    212 rules
• Shared constructable sheets created:   83 modules
• Component chunks rewritten:            68 chunks

===============================================================
📊 WEB AWESOME BUNDLE SIZE COMPARISON (BEFORE vs AFTER)
===============================================================
Metric         Baseline       Optimized      Savings      Reduction
---------------------------------------------------------------
Minified JS    803.12 KB      731.13 KB      -71.99 KB     -8.96%
Gzip           190.44 KB      176.23 KB      -14.20 KB     -7.46%
Brotli         143.00 KB      134.56 KB      -8.44 KB      -5.90%
===============================================================
```

- **-71.99 KB (-8.96%)** reduction in minified bundle size.
- **-14.20 KB (-7.46%)** reduction in network payload with Gzip.
- **-8.44 KB (-5.90%)** reduction with Brotli compression.
- **Reduced memory footprint**: Multiple components share identical `CSSStyleSheet` instances in memory, eliminating redundant parsing in browser rendering engines.

---

## Testing

Run the test suite including unit tests, virtual module resolution tests, and full bundler integration tests:

```bash
pnpm --filter @lit-core/vite-plugin run test
```

Tests verify:
1. **Cascade order**: Local component rules override shared styles when specificity matches.
2. **Tree-shaking isolation**: Importing an entry point never pulls down shared styles from unimported lazy routes.
3. **Constructable stylesheet reuse**: Components sharing styles reference the exact same `CSSStyleSheet` instance in memory.
4. **Options configuration**: Disabling or configuring `cssFuse` options works as expected.

---

## License

MIT © Jonathan Rawlings
