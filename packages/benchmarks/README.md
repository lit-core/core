# `@lit-core/benchmarks`

> Empirical bundle size, build overhead, and runtime performance benchmarks for `@lit-core` across production Lit design systems.

The `@lit-core/benchmarks` package evaluates standard Vite production builds (**Baseline**) against optimized builds across **349 production Web Components** from 5 major enterprise design systems:
- **Carbon Web Components** (`@carbon/web-components`, 99 elements)
- **Momentum Design** (`@momentum-design/components`, 97 elements)
- **Web Awesome** (`@awesome.me/webawesome`, 73 elements)
- **Spectrum Web Components** (`@spectrum-web-components/bundle`, 52 elements)
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
| `lit` | Core runtime & toolchain | `3.3.3` | n/a |
| `vite` | Core runtime & toolchain | `8.3.1` | n/a |
| `playwright` | Core runtime & toolchain | `1.63.0` | n/a |
| `node` | Core runtime & toolchain | `v24.14.0` | n/a |

---

## Executive overview (all optimizations combined)

| Metric | Carbon Web Components (99 elements) | Spectrum Web Components (52 elements) | Web Awesome (73 elements) | Momentum Design (97 elements) | Material Web (28 elements) |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Baseline bundle size** | 5801.88 KB | 1878.08 KB | 803.12 KB | 870.05 KB | 448.37 KB |
| **Optimized bundle size** | 2939.11 KB | 1749.03 KB | 806.86 KB | 843.11 KB | 469.43 KB |
| **Net bundle savings** | **-2862.76 KB (-49.34%)** | **-129.05 KB (-6.87%)** | **+3.74 KB (+0.47%)** | **-26.94 KB (-3.10%)** | **+21.06 KB (+4.70%)** |
| **Baseline build time** | 188 ms | 176 ms | 134 ms | 134 ms | 43 ms |
| **Optimized build time** | 1628 ms | 2042 ms | 706 ms | 642 ms | 363 ms |
| **Build overhead** | +1440 ms | +1866 ms | +572 ms | +508 ms | +320 ms |
| **First render speedup** | **+37.4% faster** | **+36.6% faster** | **+35.5% faster** | **+34.8% faster** | **+35.3% faster** |

> [!NOTE]
> The ~34-36% first render speedup in the combined overview is delivered primarily by ahead-of-time Lit template compilation (`@lit-core/html-aot`), which eliminates runtime HTML parsing and template preparation, supplemented by shared constructable stylesheets (`css-fuse`) and lowered properties (`props-lower`). In isolation, static fragment clustering (`html-fuse`) and template minifiers (`css-minifier`, `html-minifier`) optimize bundle size and have neutral runtime mount impact.

---

## Dedicated per-package benchmarks

Detailed benchmarks, full AST diagnostics, build durations, and runtime measurements are documented individually per package:

- [**`css-fuse` benchmark**](docs/css-fuse.md): Full CSS AST deduplication, constructable stylesheet metrics, and up to -51.6% size reduction.
- [**`html-fuse` benchmark**](docs/html-fuse.md): Static HTML and SVG fragment clustering and consolidated innerHTML parsing.
- [**`props-lower` benchmark**](docs/props-lower.md): Native Rust decorator lowering, prototype scalar hoisting, and descriptor preset deduplication.
- [**`elem-proxy` benchmark**](docs/elem-proxy.md): Deferred element proxy stubs, -72.8% script evaluation CPU time, and -67.4% to -70.2% V8 heap memory savings.
- [**`html-aot` benchmark**](docs/html-aot.md): Ahead-of-time Lit template compilation, eliminated runtime prepare overhead, and +44% render speedup.
- [**`event-hoist` benchmark**](docs/event-hoist.md): Ahead-of-time ShadowRoot event delegation, -99.9% native DOM event listeners, and -30% mount latency.
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

# Run elem-proxy runtime initialization benchmarks
pnpm run benchmark:elem-proxy

# Run event-hoist runtime delegation benchmarks
pnpm run benchmark:event-hoist

# Run resumable SSR and resumption benchmarks
pnpm run benchmark:resumable

# Output formatted markdown report
pnpm run benchmark:markdown
```
