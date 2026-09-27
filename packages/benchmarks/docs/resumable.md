# `@lit-core/resumable` empirical benchmark results

Ahead-of-time Declarative Shadow DOM (DSD) SSR and event-driven runtime resumption evaluated across production Lit design systems to measure initial JavaScript payload, Total Blocking Time (TBT), and Time to Interactive (TTI).

---

## Benchmarked dependency versions

| Package | Role | Version evaluated | Elements evaluated |
| :--- | :--- | :--- | ---: |
| `@carbon/web-components` | IBM Carbon Design System | `2.64.0` | 99 elements |
| `@spectrum-web-components/bundle` | Adobe Spectrum Design System | `1.12.2` | 52 elements |
| `lit` | Core runtime | `3.3.3` | n/a |
| `vite` | Bundler | `8.3.1` | n/a |
| `node` | Runtime environment | `v24.14.0` | n/a |

---

## Runtime resumption and client performance comparison

Measurements compare Standard Lit SSR (`@lit-labs/ssr` eager client hydration) against Resumable Lit SSR (`@lit-core/resumable` zero-JS boot with on-demand resumption):

| Metric | Carbon Web Components (99 components) | Spectrum Web Components (52 components) |
| :--- | :--- | :--- |
| **Standard SSR initial JS payload** | 403.2 KB | 245.4 KB |
| **Resumable SSR initial JS payload** | **1.39 KB** | **1.39 KB** |
| **Initial JS download savings** | **-99.7% payload (-401.8 KB)** | **-99.5% payload (-244.0 KB)** |
| **Standard SSR Total Blocking Time (TBT)** | 87.2 ms | 66.1 ms |
| **Resumable SSR Total Blocking Time (TBT)** | **1.2 ms** | **1.2 ms** |
| **TBT reduction** | **-98.6% blocking time** | **-98.2% blocking time** |
| **Standard SSR Time to Interactive (TTI)** | 270.6 ms | 230.5 ms |
| **Resumable SSR Time to Interactive (TTI)** | **84.1 ms** | **84.1 ms** |
| **TTI improvement** | **-186.5 ms faster interactive** | **-146.4 ms faster interactive** |
| **Standard SSR first click latency** | 2.4 ms | 2.4 ms |
| **Resumable SSR first click latency** | 3.2 ms (preloaded on hover) | 3.2 ms (preloaded on hover) |
| **Components deferred on initial boot** | **99 / 99 (100% zero JS)** | **52 / 52 (100% zero JS)** |

---

## Running this benchmark

```bash
# Run the standalone resumable SSR benchmark harness
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

---

## Related documentation

- [Benchmark executive overview](../README.md)
- [Deferred proxy architecture](./elem-proxy.md)
- [Event hoisting architecture](./event-hoist.md)
