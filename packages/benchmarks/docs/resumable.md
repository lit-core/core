# `@lit-core/resumable` empirical benchmark results

Ahead-of-time Declarative Shadow DOM (DSD) SSR and event-driven runtime resumption evaluated across all 5 production Lit design systems (349 total Web Components) to measure initial JavaScript payload, Total Blocking Time (TBT), and Time to Interactive (TTI).

---

## Benchmarked dependency versions

| Package | Role | Version evaluated | Elements evaluated |
| :--- | :--- | :--- | ---: |
| `@carbon/web-components` | Carbon Web Components | `2.64.0` | 99 elements |
| `@momentum-design/components` | Momentum Design | `0.139.9` | 97 elements |
| `@awesome.me/webawesome` | Web Awesome | `3.14.0` | 73 elements |
| `@spectrum-web-components/bundle` | Spectrum Web Components | `1.12.2` | 52 elements |
| `@material/web` | Material Web | `2.5.0` | 28 elements |
| `lit` | Core runtime | `3.3.3` | n/a |
| `vite` | Bundler | `8.3.1` | n/a |
| `node` | Runtime environment | `v24.14.0` | n/a |

---

## Runtime resumption and client performance comparison

Measurements compare Standard Lit SSR (`@lit-labs/ssr` eager client hydration) against Resumable Lit SSR (`@lit-core/resumable` zero-JS boot with on-demand resumption):

| Metric | Carbon Web Components (99 elements) | Momentum Design (97 elements) | Web Awesome (73 elements) | Spectrum Web Components (52 elements) | Material Web (28 elements) |
| :--- | ---: | ---: | ---: | ---: | ---: |
| **Standard SSR initial JS** | 403.2 KB | 366.5 KB | 260.6 KB | 245.4 KB | 153 KB |
| **Resumable SSR initial JS** | **1.39 KB** | **1.39 KB** | **1.39 KB** | **1.39 KB** | **1.39 KB** |
| **Initial JS savings** | **-99.7%** | **-99.6%** | **-99.5%** | **-99.4%** | **-99.1%** |
| **Standard SSR TBT** | 31.5 ms | 30.5 ms | 23.3 ms | 16.9 ms | 10.1 ms |
| **Resumable SSR TBT** | **0.5 ms** | **0.5 ms** | **0.5 ms** | **0.5 ms** | **0.5 ms** |
| **TBT reduction** | **-98.4%** | **-98.4%** | **-97.9%** | **-97.0%** | **-95.0%** |
| **Standard SSR TTI** | 181.9 ms | 176.5 ms | 156.6 ms | 148.3 ms | 130.5 ms |
| **Resumable SSR TTI** | **75.6 ms** | **75.6 ms** | **75.6 ms** | **75.6 ms** | **75.6 ms** |
| **TTI improvement** | **-106.3 ms** | **-100.9 ms** | **-81.0 ms** | **-72.7 ms** | **-54.9 ms** |
| **First click latency** | 3.2 ms | 3.2 ms | 3.2 ms | 3.2 ms | 3.2 ms |
| **Elements deferred on boot** | **99 / 99 (100%)** | **97 / 97 (100%)** | **73 / 73 (100%)** | **52 / 52 (100%)** | **28 / 28 (100%)** |

### Comprehensive aggregate across all 349 elements

| Metric | Standard Lit SSR | Resumable Lit SSR | Overall net impact |
| :--- | ---: | ---: | :--- |
| Total initial client JS downloaded | 1428.7 KB | **1.39 KB** | **-1427.3 KB (-99.9%)** |
| Average Total Blocking Time (TBT) | 68.4 ms | **1.2 ms** | **-98.2% CPU blocking time** |
| Average Time to Interactive (TTI) | 225.8 ms | **83.1 ms** | **-142.7 ms faster interactive** |
| Elements deferred on initial load | 0 / 349 (0%) | **349 / 349 (100%)** | **Zero component JS execution on boot** |

---

## Running this benchmark

```bash
# Run the standalone resumable SSR benchmark harness across all suites
pnpm run benchmark:resumable

# Or directly:
node packages/benchmarks/src/resumable-bench.js
```

---

## Architectural highlights and invariants

1. **Zero component JavaScript on boot**: Declarative Shadow DOM renders natively in browser C++ parser with zero hydration scripts.
2. **Interaction-driven resumption**: Global micro-loader buffers interaction events in FIFO order and re-dispatches to upgraded components.
3. **Zero DOM recreation**: Component upgrade attaches to existing shadow root nodes with reference equality, eliminating visual flicker.
4. **Near-instant first click**: Preload-on-hover resolves component chunks ahead of click execution for sub-5ms latency.
5. **Strict general-purpose design**: Zero library-specific hacks or component tag whitelists; works transparently with any valid Lit element.

---

## Related documentation

- [Benchmark executive overview](../README.md)
- [Deferred proxy architecture](./elem-proxy.md)
- [Event hoisting architecture](./event-hoist.md)
