# `@lit-core/benchmarks`

> Empirical bundle size, build overhead, and runtime performance benchmarks for `@lit-core` across production Lit design systems.

The `@lit-core/benchmarks` package evaluates standard Vite production builds (**Baseline**) against optimized builds across **349 production Web Components** from 5 major enterprise design systems:
- **Carbon Web Components** (`@carbon/web-components`, 99 elements)
- **Spectrum Web Components** (`@spectrum-web-components/bundle`, 52 elements)
- **Web Awesome** (`@awesome.me/webawesome`, 73 elements)
- **Momentum Design** (`@momentum-design/components`, 97 elements)
- **Material Web** (`@material/web`, 28 elements)

---

## Benchmarked dependency versions

| Package | Role | Evaluated version | Elements evaluated |
| :--- | :--- | :--- | ---: |
| `@carbon/web-components` | Design system component suite | `2.64.0` | 99 elements |
| `@spectrum-web-components/bundle` | Design system component suite | `1.12.2` | 52 elements |
| `@awesome.me/webawesome` | Design system component suite | `3.14.0` | 73 elements |
| `@momentum-design/components` | Design system component suite | `0.139.9` | 97 elements |
| `@material/web` | Design system component suite | `2.5.0` | 28 elements |
| `lit` | Core runtime and toolchain | `3.3.3` | n/a |
| `vite` | Core runtime and toolchain | `8.3.1` | n/a |
| `playwright` | Core runtime and toolchain | `1.63.0` | n/a |
| `node` | Core runtime and toolchain | `v24.14.0` | n/a |

---

## Executive overview (all optimizations combined)

| Metric | Carbon Web Components (99 elements) | Spectrum Web Components (52 elements) | Web Awesome (73 elements) | Momentum Design (97 elements) | Material Web (28 elements) |
| :--- | ---: | ---: | ---: | ---: | ---: |
| **Baseline bundle size** | 5,801.88 KB | 1,878.33 KB | 803.12 KB | 870.05 KB | 448.37 KB |
| **Optimized bundle size** | 2,967.97 KB | 1,749.28 KB | 829.51 KB | 852.21 KB | 463.36 KB |
| **Net bundle savings** | **-2,833.91 KB (-48.84%)** | **-129.05 KB (-6.87%)** | **+26.39 KB (+3.29%)** | **-17.84 KB (-2.05%)** | **+14.99 KB (+3.34%)** |
| **Baseline build time** | 196 ms | 181 ms | 110 ms | 144 ms | 42 ms |
| **Optimized build time** | 1764 ms | 2672 ms | 748 ms | 756 ms | 386 ms |
| **Build overhead** | +1568 ms | +2491 ms | +638 ms | +612 ms | +344 ms |
| **First render speedup** | **+37.4% faster** | **+36.6% faster** | **+35.5% faster** | **+35.4% faster** | **+35.6% faster** |

> [!NOTE]
> The ~34-36% first render speedup in the combined overview is delivered primarily by ahead-of-time Lit template compilation (`@lit-core/html-aot`), which eliminates runtime HTML parsing and template preparation, supplemented by shared constructable stylesheets (`css-fuse`) and lowered properties (`props-lower`). In isolation, static fragment clustering (`html-fuse`) and template minifiers (`css-minifier`, `html-minifier`) optimize bundle size and have neutral runtime mount impact.

---

## Dedicated per-package benchmarks

Detailed benchmarks, full AST diagnostics, build durations, and runtime measurements are documented individually per package:

- [**`css-fuse` benchmark**](docs/css-fuse.md): Full CSS AST deduplication, constructable stylesheet metrics, and up to -51.6% size reduction.
- [**`html-fuse` benchmark**](docs/html-fuse.md): Static HTML and SVG fragment clustering and consolidated innerHTML parsing.
- [**`props-lower` benchmark**](docs/props-lower.md): Native Rust decorator lowering, prototype scalar hoisting, and descriptor preset deduplication.
- [**`event-hoist` benchmark**](docs/event-hoist.md): Ahead-of-time ShadowRoot event delegation, -99.9% native DOM event listeners, and -30% mount latency.
- [**`dom-paths` benchmark**](docs/dom-paths.md): Ahead-of-time structural child pointer paths eliminating TreeWalker traversal and +35% mount speedup.
- [**`dirty-mask` benchmark**](docs/dirty-mask.md): Ahead-of-time property-to-part dependency bitmasking and zero dirty-checking loops.
- [**`memoize` benchmark**](docs/memoize.md): Ahead-of-time reactive expression auto-memoization and sub-millisecond updates.
- [**`elem-proxy` benchmark**](docs/elem-proxy.md): Deferred element proxy stubs, -72.8% script evaluation CPU time, and -67.4% to -70.2% V8 heap memory savings.
- [**`html-aot` benchmark**](docs/html-aot.md): Ahead-of-time Lit template compilation, eliminated runtime prepare overhead, and +44% render speedup.
- [**`native` benchmark**](docs/native.md): Ahead-of-time pure vanilla Custom Element and micro-runtime compiler with zero Lit dependencies for leaf components.
- [**`css-minifier` benchmark**](docs/css-minifier.md): High-speed Lightning CSS template minification.
- [**`html-minifier` benchmark**](docs/html-minifier.md): High-speed OXC HTML and SVG template minification.
- [**`resumable` benchmark**](docs/resumable.md): Zero-JavaScript Declarative Shadow DOM SSR, -99.5% initial client JavaScript payload, and -98.2% Total Blocking Time.

---

## Running benchmarks

```bash
# Run all benchmark suites
pnpm run benchmark

# Run a specific suite
pnpm run benchmark:webawesome
pnpm run benchmark:momentum
node packages/benchmarks/src/index.js --suite=carbon
node packages/benchmarks/src/index.js --suite=spectrum
node packages/benchmarks/src/index.js --suite=material

# Run isolated tools
node packages/benchmarks/src/index.js --tools=css-fuse
node packages/benchmarks/src/index.js --tools=html-fuse
node packages/benchmarks/src/index.js --tools=props-lower
node packages/benchmarks/src/index.js --tools=html-aot
node packages/benchmarks/src/index.js --tools=css-minifier
node packages/benchmarks/src/index.js --tools=html-minifier

# Run standalone runtime and optimization benchmarks
pnpm run benchmark:elem-proxy
pnpm run benchmark:event-hoist
pnpm run benchmark:dom-paths
pnpm run benchmark:dirty-mask
pnpm run benchmark:memoize
pnpm run benchmark:resumable

# Output formatted markdown report
pnpm run benchmark:markdown
```
