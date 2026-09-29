# `@lit-core/resumable` empirical benchmark results

Ahead-of-time Declarative Shadow DOM (DSD) SSR and event-driven runtime resumption evaluated across all 5 production Lit design systems (349 total Web Components) to measure initial JavaScript payload, Total Blocking Time (TBT), and Time to Interactive (TTI).

---

## Benchmarked dependency versions

| Package | Role | Version evaluated | Elements evaluated |
| :--- | :--- | :--- | ---: |
| `@carbon/web-components` | IBM Carbon Design System | `2.64.0` | 99 elements |
| `@spectrum-web-components/bundle` | Adobe Spectrum Design System | `1.12.2` | 52 elements |
| `@awesome.me/webawesome` | Web Awesome component suite | `3.14.0` | 73 elements |
| `@momentum-design/components` | Cisco Momentum Design System | `0.139.9` | 97 elements |
| `@material/web` | Google Material Design 3 | `2.5.0` | 28 elements |
| `lit` | Core runtime | `3.3.3` | n/a |
| `vite` | Bundler | `8.3.1` | n/a |
| `playwright` | Runtime evaluation engine | `1.63.0` | n/a |
| `node` | Runtime environment | `v24.14.0` | n/a |

---

## Runtime resumption and client performance comparison

Measurements compare Standard Lit SSR (`@lit-labs/ssr` eager client hydration) against Resumable Lit SSR (`@lit-core/resumable` zero-JS boot with on-demand resumption):

| Metric | Carbon | Spectrum | Web Awesome | Momentum | Material Web |
| :--- | ---: | ---: | ---: | ---: | ---: |
| Standard SSR initial JS | 403.2 KB | 245.4 KB | 260.6 KB | 366.5 KB | 153.0 KB |
| Resumable SSR initial JS | **1.42 KB** | **1.42 KB** | **1.42 KB** | **1.42 KB** | **1.42 KB** |
| Initial JS savings | **-99.6%** | **-99.4%** | **-99.5%** | **-99.6%** | **-99.1%** |
| Standard SSR TBT | 31.8 ms | 17.1 ms | 23.4 ms | 30.6 ms | 10.0 ms |
| Resumable SSR TBT | **1.7 ms** | **0.5 ms** | **0.5 ms** | **0.5 ms** | **0.5 ms** |
| TBT reduction | **-94.7%** | **-97.1%** | **-97.9%** | **-98.4%** | **-95.0%** |
| Standard SSR TTI | 182.2 ms | 148.5 ms | 156.7 ms | 176.6 ms | 130.4 ms |
| Resumable SSR TTI | **76.8 ms** | **75.6 ms** | **75.6 ms** | **75.6 ms** | **75.6 ms** |
| TTI improvement | **-105.4 ms** | **-72.9 ms** | **-81.1 ms** | **-101.0 ms** | **-54.8 ms** |
| First click latency | 3.2 ms | 3.2 ms | 3.2 ms | 3.2 ms | 3.2 ms |
| Elements deferred on boot | **99 / 99 (100%)** | **52 / 52 (100%)** | **73 / 73 (100%)** | **97 / 97 (100%)** | **28 / 28 (100%)** |

> [!NOTE]
> Standard Lit SSR requires downloading and hydrating all component classes and Lit runtimes upfront before components become interactive. `@lit-core/resumable` renders HTML and CSS via native Declarative Shadow DOM with zero client JavaScript on boot, deferring component hydration until user interaction.

---

## Resumption diagnostics and payload analysis

Detailed payload reduction, CPU blocking time improvements, and deferred element proportions across design systems:

| Design system or library | Components evaluated | Initial JS reduction | TBT reduction | TTI speedup | Deferred proportion | Build overhead |
| :--- | ---: | ---: | ---: | ---: | ---: | :--- |
| Carbon Web Components | 99 | **-99.6%** | **-94.7%** | **-105.40 ms** | **99 / 99 (100%)** | Fast native pass |
| Spectrum Web Components | 52 | **-99.4%** | **-97.1%** | **-72.90 ms** | **52 / 52 (100%)** | Fast native pass |
| Web Awesome | 73 | **-99.5%** | **-97.9%** | **-81.10 ms** | **73 / 73 (100%)** | Fast native pass |
| Momentum Design | 97 | **-99.6%** | **-98.4%** | **-101.00 ms** | **97 / 97 (100%)** | Fast native pass |
| Material Web | 28 | **-99.1%** | **-95.0%** | **-54.80 ms** | **28 / 28 (100%)** | Fast native pass |

---

## Running this benchmark

```bash
node packages/benchmarks/src/resumable-bench.js
```

---

## Architectural highlights and invariants

- **Zero component JavaScript on boot**: Declarative Shadow DOM renders natively in browser C++ parser with zero hydration scripts.
- **Interaction-driven resumption**: Global micro-loader buffers interaction events in FIFO order and re-dispatches to upgraded components.
- **Zero DOM recreation**: Component upgrade attaches to existing shadow root nodes with reference equality, eliminating visual flicker.
- **Near-instant first click**: Preload-on-hover resolves component chunks ahead of click execution for sub-5ms latency.
- **Strict general-purpose design**: Zero library-specific hacks or component tag whitelists; works transparently with any valid Lit element.

---

## Related documentation

- [Benchmark executive overview](../README.md)
- [Deferred proxy architecture](./elem-proxy.md)
- [Event hoisting architecture](./event-hoist.md)
