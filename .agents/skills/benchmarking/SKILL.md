---
name: benchmarking
description: >-
  Execute, analyze, and format bundle size and deduplication benchmarks for lit-core.
  Use when running benchmarks across Carbon, Spectrum, Web Awesome, or Material Web,
  comparing optimization impacts, or formatting benchmark markdown reports.
---

# Benchmark execution and reporting guide

This skill guides you through running, analyzing, and formatting benchmarks in `@lit-core/benchmarks`.

## Available suites

- `carbon`: `@carbon/web-components` (IBM Carbon, 99 components)
- `spectrum`: `@spectrum-web-components` (Adobe Spectrum, 52 components)
- `webawesome`: `@awesome.me/webawesome` (73 components)
- `material`: `@material/web` (Google Material Design 3, 28 components)
- `momentum`: `@momentum-design/components` (Cisco Momentum Design, 97 components)
- `all`: Runs all five suites in sequence

## Execution commands

```bash
# Run all benchmark suites with terminal tables
pnpm run benchmark

# Run an individual suite
pnpm run benchmark:webawesome
pnpm run benchmark:momentum
node packages/benchmarks/src/index.js --suite=carbon
node packages/benchmarks/src/index.js --suite=spectrum
node packages/benchmarks/src/index.js --suite=material
node packages/benchmarks/src/index.js --suite=momentum

# Run isolated tools
node packages/benchmarks/src/index.js --tools=css-fuse
node packages/benchmarks/src/index.js --tools=html-fuse
node packages/benchmarks/src/index.js --tools=props-lower
node packages/benchmarks/src/index.js --tools=html-aot
node packages/benchmarks/src/index.js --tools=css-minifier
node packages/benchmarks/src/index.js --tools=html-minifier

# Run elem-proxy runtime initialization benchmarks
pnpm run benchmark:elem-proxy

# Generate clean markdown output
pnpm run benchmark:markdown
```

## Mandatory benchmark structure: one benchmark per package

Each tool has its own dedicated benchmark document in `packages/benchmarks/docs/`. **NEVER merge separate tools into one document**:

- `packages/benchmarks/docs/css-fuse.md`: CSS AST deduplication and constructable stylesheets.
- `packages/benchmarks/docs/html-fuse.md`: Static HTML and SVG fragment clustering.
- `packages/benchmarks/docs/props-lower.md`: Decorator lowering, descriptor preset deduplication, prototype scalar hoisting.
- `packages/benchmarks/docs/elem-proxy.md`: Deferred element proxy stubs, script evaluation CPU time, heap memory.
- `packages/benchmarks/docs/html-aot.md`: Ahead-of-time Lit template compilation and runtime prepare elimination.
- `packages/benchmarks/docs/css-minifier.md`: Embedded CSS template literal minification via Lightning CSS.
- `packages/benchmarks/docs/html-minifier.md`: Embedded HTML/SVG template literal minification via OXC.

## Reporting and formatting rules

1. **Avoid repetitive tables**:
   - Present a single **Results summary** table comparing Baseline vs. Optimized (Minified JS, Gzip, Brotli, and delta savings).
   - Present a separate **Deduplication diagnostics** table for AST metrics (rules scanned, duplicate rules fused, shared sheets created, chunks rewritten).
   - Do NOT duplicate rows across multiple nested accordions.
2. **Casing and punctuation**:
   - Always use sentence case for all table headers, section titles, and descriptions. Do not uppercase every word.
   - Strictly NO em dashes (`—` or `--`). Use `n/a` or `-` for non-applicable values.
3. **Build overhead profiling**:
   - Native Rust transforms (`css-minifier`, `html-minifier`, `props-lower`) have near-zero overhead (<100 ms total across 100 components).
   - Node.js AST compiler passes (`html-aot`) run in JavaScript and must always use fast-path regex checks (`LIT_HTML_AOT_FAST_CHECK`) before AST parsing to prevent unneeded overhead on non-Lit modules.
4. **Mandatory executive overview synchronization**:
   - Whenever any benchmark pass, AST visitor, or runtime measurement logic is modified or audited, always re-evaluate the full benchmark suite across all 5 design systems with all active tools enabled (`node packages/benchmarks/src/index.js`).
   - Immediately update the **Executive overview (all optimizations combined)** table in `packages/benchmarks/README.md` with the live, measured build times, bundle sizes, and first render speedups. Never leave stale numbers in the executive overview.
