# Methodology and benchmark design

Bundle size, build time, and runtime measurements in `@lit-core/benchmarks` evaluate real-world production Lit component libraries under standardized conditions.

---

## Evaluation principles

1. **Production library realism**:
   Rather than synthetic microbenchmarks, the suite executes against official npm releases of major production design systems:
   - IBM Carbon (`@carbon/web-components`)
   - Adobe Spectrum (`@spectrum-web-components/bundle`)
   - Web Awesome (`@awesome.me/webawesome`)
   - Google Material Web (`@material/web`)
   - Cisco Momentum (`@momentum-design/components`)

2. **Strict general-purpose neutrality**:
   Every compiler pass, deduplication pass, and bundling plugin operates strictly in accordance with official Web Component, DOM, HTML, CSS, JavaScript, and Lit language specifications. No tool contains library-specific whitelist tags, class-name heuristics, or hardcoded component rules.

3. **Isolated vs combined benchmarking**:
   Every optimization tool is measured both in complete isolation against the baseline and combined together in the `TOTAL` configuration to evaluate compounding benefits and potential interference.

---

## Measurement pipelines

### 1. Static bundle sizes

Each suite builds a single entry module that imports all components from the design system:
- **Baseline**: Standard Vite build with Rollup minification (`minify: true`), with zero `@lit-core` plugins.
- **Optimized (per-tool)**: Vite build with only the specific tool enabled.
- **Optimized (total)**: Vite build with all registered `@lit-core` tools enabled via `@lit-core/vite-plugin`.

Bundle metrics recorded:
- **Minified JS (raw bytes)**: Uncompressed JavaScript bundle size written to disk.
- **Gzip (bytes)**: Size compressed using zlib default level 9.
- **Brotli (bytes)**: Size compressed using brotli default level 11.

### 2. Build time overhead

Build durations measure end-to-end bundling time via `performance.now()` in Node.js:
- Records baseline build time vs optimized build time.
- Verifies that native Rust AST analysis (`oxc`, `lightningcss`) executes with minimal overhead compared to pure JavaScript transforms.

### 3. Browser runtime latency

Runtime benchmarks execute inside headless Chromium via Playwright:
- **First render (mount)**: Latency to mount component instances into the document DOM, attach shadow roots, and complete initial Lit render updates.
- **Re-render (update)**: Latency to dispatch property updates across all mounted components and await `element.updateComplete`.
- Evaluated over multiple iterations to smooth V8 JIT warmup and garbage collection variance.

### 4. Runtime proxy initialization (`elem-proxy`)

The `elem-proxy-bench.js` harness evaluates script evaluation CPU time and V8 heap memory:
- Compares eager class evaluation during script evaluation against deferred evaluation where Custom Element classes are created on demand when mounted or queried.
- Quantifies V8 heap memory savings and deferred class percentages.

---

## Related documentation

- [Metrics and reporting reference](metrics.md)
- [CSS deduplication engine architecture](../../css-fuse/docs/architecture.md)
- [HTML fragment clustering guide](../../html-fuse/docs/fragment-clustering.md)
- [Deferred element proxy architecture](../../elem-proxy/docs/proxy-architecture.md)
