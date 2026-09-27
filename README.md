# lit-core

> Ahead-of-time compiler and bundler optimization toolchain for Lit and Web Components.

`@lit-core` optimizes Web Component applications at build time. It eliminates duplicate styles in Shadow DOM, lowers runtime decorator reflection, clusters static template fragments, compiles templates ahead of time, and defers component instantiation until elements are mounted.

---

## Packages

| Package | Path | Purpose | Documentation |
| :--- | :--- | :--- | :--- |
| [`@lit-core/css-fuse`](packages/css-fuse/) | `packages/css-fuse` | Cross-component CSS deduplication into shared constructable sheets | [README](packages/css-fuse/README.md) · [Architecture](packages/css-fuse/docs/architecture.md) |
| [`@lit-core/html-fuse`](packages/html-fuse/) | `packages/html-fuse` | Static HTML and SVG fragment clustering | [README](packages/html-fuse/README.md) · [Guide](packages/html-fuse/docs/fragment-clustering.md) |
| [`@lit-core/props-lower`](packages/props-lower/) | `packages/props-lower` | AOT Lit decorator and reactive property lowering | [README](packages/props-lower/README.md) · [Guide](packages/props-lower/docs/transform-mechanics.md) |
| [`@lit-core/event-hoist`](packages/event-hoist/) | `packages/event-hoist` | Ahead-of-time ShadowRoot event delegation | [README](packages/event-hoist/README.md) |
| [`@lit-core/elem-proxy`](packages/elem-proxy/) | `packages/elem-proxy` | Deferred Custom Element stubs and JIT class upgrade | [README](packages/elem-proxy/README.md) · [Architecture](packages/elem-proxy/docs/proxy-architecture.md) |
| [`@lit-core/html-aot`](packages/html-aot/) | `packages/html-aot` | Ahead-of-time Lit template compilation | [README](packages/html-aot/README.md) · [Guide](packages/html-aot/docs/template-compilation.md) |
| [`@lit-core/css-minifier`](packages/css-minifier/) | `packages/css-minifier` | High-speed CSS template literal minification | [README](packages/css-minifier/README.md) |
| [`@lit-core/html-minifier`](packages/html-minifier/) | `packages/html-minifier` | High-speed HTML and SVG template literal minification | [README](packages/html-minifier/README.md) |
| [`@lit-core/resumable`](packages/resumable/) | `packages/resumable` | Zero-JS SSR and interaction-driven runtime resumption | [README](packages/resumable/README.md) |
| [`@lit-core/vite-plugin`](packages/vite-plugin/) | `packages/vite-plugin` | Unified Vite and Rollup plugin | [README](packages/vite-plugin/README.md) · [Configuration](packages/vite-plugin/docs/configuration.md) |
| [`@lit-core/webpack-plugin`](packages/webpack-plugin/) | `packages/webpack-plugin` | Unified Webpack 5 plugin | [README](packages/webpack-plugin/README.md) · [Configuration](packages/webpack-plugin/docs/configuration.md) |
| [`@lit-core/benchmarks`](packages/benchmarks/) | `packages/benchmarks` | Empirical benchmark harness across production design systems | [README](packages/benchmarks/README.md) · [Reports](packages/benchmarks/docs/css-fuse.md) |

---

## Benchmark summary

Evaluated across **349 production Web Components** from 5 enterprise design systems:

| Design system or library | Elements | Baseline size | Optimized size | Net savings | First render speedup |
| :--- | ---: | ---: | ---: | ---: | ---: |
| Carbon Web Components | 99 | 5,801.88 KB | 2,807.41 KB | **-2,994.47 KB (-51.61%)** | **+45.1%** |
| Spectrum Web Components | 52 | 1,739.92 KB | 1,740.01 KB | **+0.09 KB (+0.01%)** | **+44.3%** |
| Web Awesome | 73 | 803.12 KB | 739.10 KB | **-64.02 KB (-7.97%)** | **+43.1%** |
| Momentum Design | 97 | 870.05 KB | 867.15 KB | **-2.90 KB (-0.33%)** | **+44.3%** |
| Material Web | 28 | 448.37 KB | 450.49 KB | **+2.11 KB (+0.47%)** | **+43.4%** |
| **Total** | **349** | **9,663.34 KB** | **6,604.18 KB** | **-3,059.16 KB (-31.66%)** | **+44.0%** |

In addition, `@lit-core/elem-proxy` reduces initial script evaluation CPU time by **-72.8%** and V8 heap memory by **-67.4%** by deferring class evaluation until elements are mounted.

### Dedicated benchmark reports

Detailed AST diagnostics, build durations, and runtime measurements are documented individually per package:

- [`css-fuse` benchmark report](packages/benchmarks/docs/css-fuse.md)
- [`html-fuse` benchmark report](packages/benchmarks/docs/html-fuse.md)
- [`props-lower` benchmark report](packages/benchmarks/docs/props-lower.md)
- [`event-hoist` benchmark report](packages/benchmarks/docs/event-hoist.md)
- [`elem-proxy` benchmark report](packages/benchmarks/docs/elem-proxy.md)
- [`html-aot` benchmark report](packages/benchmarks/docs/html-aot.md)
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
