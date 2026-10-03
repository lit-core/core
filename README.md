# lit-core

> High-performance compiler toolchain and delivery architecture for Lit and Web Components.

`@lit-core` optimizes the scale, loading, and runtime performance of Lit and Web Component applications. By shifting runtime costs to build time and providing modern delivery strategies, it enables component libraries and enterprise applications to achieve minimal bundle footprints, instant page loads, and native platform efficiency without compromising developer ergonomics.

---

## Compiler and optimization packages

| Package | Purpose |
| :--- | :--- |
| [`@lit-core/css-fuse`](packages/css-fuse/) | Cross-component CSS deduplication into shared constructable sheets |
| [`@lit-core/html-fuse`](packages/html-fuse/) | Static HTML and SVG fragment clustering |
| [`@lit-core/props-lower`](packages/props-lower/) | AOT Lit decorator and reactive property lowering |
| [`@lit-core/event-hoist`](packages/event-hoist/) | Ahead-of-time ShadowRoot event delegation |
| [`@lit-core/dom-paths`](packages/dom-paths/) | Ahead-of-time structural DOM path compiler eliminating TreeWalker mounting traversal |
| [`@lit-core/dirty-mask`](packages/dirty-mask/) | Ahead-of-time property-to-part dependency bitmasking |
| [`@lit-core/directives`](packages/directives/) | Ahead-of-time Lit directive lowering compiler eliminating runtime wrapper allocations |
| [`@lit-core/memoize`](packages/memoize/) | Ahead-of-time reactive expression auto-memoization |
| [`@lit-core/elem-proxy`](packages/elem-proxy/) | Deferred custom element stubs and JIT class upgrade |
| [`@lit-core/html-aot`](packages/html-aot/) | Ahead-of-time Lit template compilation |
| [`@lit-core/native`](packages/native/) | Ahead-of-time vanilla Web Component and micro-runtime compiler |
| [`@lit-core/css-minifier`](packages/css-minifier/) | CSS template literal minification |
| [`@lit-core/html-minifier`](packages/html-minifier/) | HTML and SVG template literal minification |
| [`@lit-core/resumable`](packages/resumable/) | Zero-JS SSR and interaction-driven runtime resumption |
| [`@lit-core/tag-shake`](packages/tag-shake/) | Ahead-of-time Web Component dead code elimination and registration tag shaking |

---

## Bundler plugins

| Package | Purpose |
| :--- | :--- |
| [`@lit-core/vite-plugin`](packages/vite-plugin/) | Unified Vite and Rollup plugin |
| [`@lit-core/webpack-plugin`](packages/webpack-plugin/) | Unified Webpack 5 plugin |

---

## Benchmarks and testing

| Package | Purpose |
| :--- | :--- |
| [`@lit-core/benchmarks`](packages/benchmarks/) | Empirical benchmark harness across production design systems |
| [`@lit-core/tests`](packages/tests/) | Real component multi-framework Playwright test suite (2,305 tests) |

---

## Benchmark summary

Evaluated across **349 production Web Components** from 5 enterprise design systems:

| Design system or library | Elements | Baseline size | Optimized size | Net savings | First render speedup | Re-render speedup | Boot CPU savings |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Carbon Web Components | 99 | 5,801.88 KB | 2,967.97 KB | **-2,833.91 KB (-48.84%)** | n/a | **+13.8%** | **-73.1%** |
| Spectrum Web Components | 52 | 1,878.33 KB | 1,749.28 KB | **-129.05 KB (-6.87%)** | n/a | **+13.8%** | **-72.0%** |
| Web Awesome | 73 | 803.12 KB | 829.51 KB | **+26.39 KB (+3.29%)** | n/a | **+13.8%** | **-73.5%** |
| Momentum Design | 97 | 870.05 KB | 852.21 KB | **-17.84 KB (-2.05%)** | n/a | **+13.8%** | **-72.1%** |
| Material Web | 28 | 448.37 KB | 463.36 KB | **+14.99 KB (+3.34%)** | n/a | **+13.8%** | **-72.4%** |

### Dedicated benchmark reports

Detailed AST diagnostics, build durations, and runtime measurements are documented individually per package:

- [`css-fuse` benchmark report](packages/benchmarks/docs/css-fuse.md)
- [`html-fuse` benchmark report](packages/benchmarks/docs/html-fuse.md)
- [`props-lower` benchmark report](packages/benchmarks/docs/props-lower.md)
- [`event-hoist` benchmark report](packages/benchmarks/docs/event-hoist.md)
- [`dom-paths` benchmark report](packages/benchmarks/docs/dom-paths.md)
- [`dirty-mask` benchmark report](packages/benchmarks/docs/dirty-mask.md)
- [`directives` benchmark report](packages/benchmarks/docs/directives.md)
- [`memoize` benchmark report](packages/benchmarks/docs/memoize.md)
- [`elem-proxy` benchmark report](packages/benchmarks/docs/elem-proxy.md)
- [`html-aot` benchmark report](packages/benchmarks/docs/html-aot.md)
- [`native` benchmark report](packages/benchmarks/docs/native.md)
- [`css-minifier` benchmark report](packages/benchmarks/docs/css-minifier.md)
- [`html-minifier` benchmark report](packages/benchmarks/docs/html-minifier.md)
- [`resumable` benchmark report](packages/benchmarks/docs/resumable.md)
- [Monorepo benchmark overview](packages/benchmarks/README.md)

---

## Contributing and architecture

- [Contributing guide](CONTRIBUTING.md): Environment setup, prerequisites, building native Rust crates, and running tests.
- [Monorepo architecture guidelines](AGENTS.md): Architectural principles, safety invariants, and general-purpose design constraints.

---

## License

MIT
