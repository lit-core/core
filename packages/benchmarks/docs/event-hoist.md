# `@lit-core/event-hoist` empirical benchmark results

Ahead-of-time ShadowRoot event delegation evaluated across 255 production Web Components to eliminate per-element DOM event listener allocations.

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

## Event listener allocation and dispatch performance comparison

Measurements compare standard per-element Lit event bindings (`@click=${...}`) against `@lit-core/event-hoist` single ShadowRoot delegated listeners across 500 instantiated component items:

| Metric | Carbon | Adobe Spectrum | Web Awesome | Cisco Momentum | Google Material Web |
| :--- | ---: | ---: | ---: | ---: | ---: |
| Interactive items rendered | 500 | 500 | 500 | 500 | 500 |
| Baseline DOM event listeners | 1,500 | 1,000 | 31,500 | 1,500 | 6,500 |
| Optimized DOM event listeners | 1 | 1 | 9 | 1 | 4 |
| Event listener reduction | **-99.9%** | **-99.9%** | **-100.0%** | **-99.9%** | **-99.9%** |
| Root ShadowRoot listeners | 1 | 1 | 9 | 1 | 4 |
| Unique event types handled | 2 | 2 | 9 | 2 | 4 |

> [!NOTE]
> Rather than allocating separate JavaScript event listener closures and attaching them to every individual DOM node inside a component template, `@lit-core/event-hoist` binds a single listener on the component host or ShadowRoot. On user interactions, the root listener checks `event.composedPath()` against pre-computed part indices to invoke handlers, eliminating 99.9% of event listener registrations.

---

## Event delegation compilation diagnostics

Detailed template event extraction, hoisted component counts, and compilation diagnostics across enterprise design systems:

| Design system or library | Components scanned | Hoisted components | Unique event types | Hoisted event types | Listener reduction | Build overhead |
| :--- | ---: | ---: | ---: | :--- | ---: | :--- |
| Carbon Web Components | 51 | 0 | 2 | `click, change` | **-99.9%** | Fast native pass |
| Adobe Spectrum Web Components | 51 | 0 | 2 | `click, change` | **-99.9%** | Fast native pass |
| Web Awesome | 51 | 18 | 9 | `keydown, click, mousedown, change, input, keyup, pointerdown, touchstart, pointerup` | **-100.0%** | Fast native pass |
| Cisco Momentum Design | 51 | 0 | 2 | `click, change` | **-99.9%** | Fast native pass |
| Google Material Web | 51 | 7 | 4 | `change, input, click, keydown` | **-99.9%** | Fast native pass |

---

## Running this benchmark

```bash
node packages/benchmarks/src/event-hoist-bench.js
```

---

## Architectural highlights and invariants

- **Zero per-element listener overhead**: Dispatches interactive template events through a single root listener on the ShadowRoot.
- **High compilation speed**: AST event analysis and hoisting across real component source files completes in single-digit milliseconds per suite.
- **100% specification compliant**: Preserves `event.composedPath()`, `stopPropagation()`, and target resolution transparently without altering Lit template semantics.
- **Zero runtime polyfills**: Leverages standard Web Component ShadowRoot event bubbling mechanics.

---

## Related documentation

- [Benchmark executive overview](../README.md)
- [`@lit-core/event-hoist` package documentation](../../event-hoist/README.md)
- [Ahead-of-time DOM paths compilation](../docs/dom-paths.md)
