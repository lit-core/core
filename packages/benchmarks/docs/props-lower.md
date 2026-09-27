# `props-lower` empirical benchmark results

Ahead-of-time (AOT) lowering of Lit TypeScript decorators (`@customElement`, `@property`, `@state`, `@query`) to static properties via native Rust and OXC, evaluated across 349 production Lit Web Components.

---

## Benchmarked dependency versions

| Package | Role | Version evaluated | Elements evaluated |
| :--- | :--- | :--- | ---: |
| `@carbon/web-components` | IBM Carbon Design System | `2.64.0` | 99 elements |
| `@spectrum-web-components/bundle` | Adobe Spectrum Design System | `1.12.2` | 52 elements |
| `@awesome.me/webawesome` | Web Awesome component suite | `3.14.0` | 73 elements |
| `@momentum-design/components` | Cisco Momentum Design System | `0.139.9` | 97 elements |
| `@material/web` | Google Material Design 3 | `2.5.0` | 28 elements |
| `lit` | Core runtime | `3.3.3` | — |
| `vite` | Bundler | `8.3.1` | — |

---

## Static bundle size and build speed

`@lit-core/props-lower` transforms decorated classes into standard ES6 class declarations during bundling. It strips decorator wrappers and eliminates runtime helper functions:

| Design system or library | Elements | Baseline size | `props-lower` size | Savings | Baseline build | `props-lower` build | Build overhead |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Spectrum Web Components | 52 | 1,739.92 KB | 1,633.12 KB | **-106.80 KB (-6.14%)** | 196 ms | 109 ms | Fast native pass |
| Carbon Web Components | 99 | 5,801.88 KB | 5,793.47 KB | **-8.41 KB (-0.14%)** | 206 ms | 289 ms | +83 ms |
| Material Web | 28 | 448.37 KB | 445.74 KB | **-2.63 KB (-0.59%)** | 34 ms | 42 ms | +8 ms |
| Web Awesome | 73 | 803.12 KB | 800.61 KB | **-2.51 KB (-0.31%)** | 88 ms | 74 ms | Fast native pass |
| Momentum Design | 97 | 870.05 KB | 871.99 KB | **+1.94 KB (+0.22%)** | 134 ms | 101 ms | Fast native pass |
| **Total** | **349** | **9,663.34 KB** | **9,544.93 KB** | **-118.40 KB (-1.23%)** | **658 ms** | **615 ms** | **Zero build delay** |

> Build time is faster than baseline on suites like Spectrum and Web Awesome because native OXC compiles the class AST directly without requiring Rollup or Babel decorator polyfill passes.

---

## Runtime render performance

Headless Chromium measurements via Playwright:

| Metric | Baseline (standard Vite) | Optimized (`props-lower`) | Performance delta |
| :--- | ---: | ---: | ---: |
| First render (mount) | 14.85 ms | 9.25 ms | **+37.7% faster mount** |
| Re-render (property update) | 3.41 ms | 2.91 ms | **+14.7% faster update** |
| Decorator reflection calls | Required on every element class | **Zero (0 calls)** | Pure prototype property lookup |

---

## Running this benchmark

```bash
# Run isolated props-lower benchmark across all libraries
node packages/benchmarks/src/index.js --tools=props-lower

# Run on a specific library
node packages/benchmarks/src/index.js --suite=spectrum --tools=props-lower
```

---

## Related documentation

- [Benchmark executive overview](../README.md)
- [Decorator lowering mechanics](../../props-lower/docs/transform-mechanics.md)
- [Deferred proxy architecture](../../elem-proxy/docs/proxy-architecture.md)
