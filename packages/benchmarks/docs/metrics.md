# Metrics and reporting reference

Overview of every metric collected by `@lit-core/benchmarks`, how it is calculated, and what it indicates for application performance.

---

## Core metric definitions

### Bundle size metrics

| Metric | Source | Unit | Significance |
| :--- | :--- | :--- | :--- |
| **Minified JS (raw size)** | Disk size of generated JavaScript bundle | Kilobytes (KB) | Script parse and compile time in V8 |
| **Gzip size** | Deflate level 9 compression | Kilobytes (KB) | Network transfer time over HTTP/1.1 and HTTP/2 |
| **Brotli size** | Brotli level 11 compression | Kilobytes (KB) | Network transfer time over modern HTTP/2 and HTTP/3 |
| **Net savings (Δ)** | Difference between baseline and optimized size | KB and percentage (%) | Total payload reduction achieved |

### Build performance metrics

| Metric | Source | Unit | Significance |
| :--- | :--- | :--- | :--- |
| **Baseline build time** | Vite build without `@lit-core` plugins | Milliseconds (ms) | Standard compilation baseline |
| **Optimized build time** | Vite build with `@lit-core` optimization enabled | Milliseconds (ms) | Total compilation time |
| **Build overhead** | Optimized build time minus baseline build time | Milliseconds (ms) | Rust compiler and AST transform cost |

### Browser runtime metrics

| Metric | Source | Unit | Significance |
| :--- | :--- | :--- | :--- |
| **First render (mount)** | Playwright Chromium render pass | Milliseconds (ms) | Initial component hydration and Shadow DOM attachment |
| **Re-render (update)** | Playwright Chromium attribute update pass | Milliseconds (ms) | Dynamic update cycle speed |
| **Render speedup** | First render latency reduction | Percentage (%) | End-user responsiveness improvement |

### Deferred proxy metrics (`elem-proxy`)

| Metric | Source | Unit | Significance |
| :--- | :--- | :--- | :--- |
| **Script evaluation time** | V8 VM context evaluation | Milliseconds (ms) | Main-thread blocking time during initial bundle load |
| **V8 heap memory** | V8 heap statistics (`used_heap_size`) | Kilobytes (KB) | Memory footprint of loaded component definitions |
| **Deferred execution savings** | Uninstantiated vs total element classes | Percentage (%) | Proportion of code avoided during initial boot |
| **JIT upgrade latency** | DOM connection of proxy stub | Milliseconds (ms) | Incremental cost when component is first mounted |

---

## Diagnostics metrics

### CSS deduplication diagnostics (`css-fuse`)

- **Rules scanned**: Total CSS declaration blocks parsed across all components.
- **Duplicate rules fused**: Number of redundant declaration blocks extracted into shared constructable sheets.
- **Shared sheets created**: Number of unique constructable stylesheet modules generated.
- **Chunks rewritten**: Component files updated to adopt shared sheets.

### HTML template deduplication diagnostics (`html-fuse`)

- **Fragments scanned**: Total static HTML and SVG subtrees analyzed.
- **Duplicate fragments fused**: Number of static subtrees consolidated into shared template constants.
- **Shared templates created**: Virtual module template descriptors instantiated.
- **Components rewritten**: Lit components updated to import shared subtrees.

---

## Related documentation

- [Benchmark methodology](methodology.md)
- [CSS deduplication engine architecture](../../css-fuse/docs/architecture.md)
- [Ahead-of-time template compilation architecture](../../html-aot/docs/template-compilation.md)
