# `event-hoist` empirical benchmark results

Ahead-of-time (AOT) compiler pass hoisting child element event listeners to a single delegated listener on ShadowRoot, evaluated across 349 production Lit Web Components.

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

## Bundle size and runtime performance comparison

Measurements compare a standard Vite production build with minification (`minify: true`) against an identical build with only `@lit-core/event-hoist` enabled. Runtime performance is evaluated in headless Chromium via Playwright across all component suites.

| Metric | Carbon Web Components (99 elements) | Spectrum Web Components (52 elements) | Web Awesome (73 elements) | Momentum Design (97 elements) | Material Web (28 elements) |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Baseline bundle size** | 5801.88 KB | 1878.08 KB | 803.12 KB | 870.05 KB | 448.37 KB |
| **Optimized bundle size** | 5887.06 KB | 1878.08 KB | 848.13 KB | 900.66 KB | 461.87 KB |
| **Net bundle savings** | **+85.19 KB (+1.47%)** | **-0.00 KB (-0.00%)** | **+45.01 KB (+5.60%)** | **+30.61 KB (+3.52%)** | **+13.50 KB (+3.01%)** |
| **Baseline mount latency** | 15.12 ms | 15.12 ms | 14.80 ms | 14.84 ms | 14.88 ms |
| **Optimized mount latency** | 14.88 ms | 15.12 ms | 14.88 ms | 14.80 ms | 14.92 ms |
| **Mount speedup** | **+1.6% (neutral)** | **+0.0% (neutral)** | **-0.5% (neutral)** | **+0.3% (neutral)** | **-0.3% (neutral)** |
| **Baseline update latency** | 3.45 ms | 3.45 ms | 3.40 ms | 3.41 ms | 3.41 ms |
| **Optimized update latency** | 3.41 ms | 3.45 ms | 3.41 ms | 3.40 ms | 3.42 ms |
| **Update speedup** | **+1.2% (neutral)** | **+0.0% (neutral)** | **-0.3% (neutral)** | **+0.3% (neutral)** | **-0.3% (neutral)** |

> [!NOTE]
> `event-hoist` hoists template event bindings (`@click`, `@input`, `@keydown`) from individual child elements onto a single delegated listener attached to the component's `ShadowRoot`. The delegation dispatch trampoline and lookup metadata introduce a minor static bundle size overhead (+1.4% to +5.6%), while drastically reducing the number of native DOM event listener allocations in high-density or virtualized views.

---

## High-density template listener delegation benchmarks

Evaluates native DOM event listener allocations, component mount latency, and memory footprint when rendering repeating template rows or lists:

### Virtual data table rows (500 items)

| Metric | Standard Lit (baseline) | @lit-core/event-hoist | Improvement |
| :--- | ---: | ---: | ---: |
| Native DOM event listeners | 2,000 | 3 | **-99.9%** |
| Component mount latency | 0.48 ms | 0.52 ms | +8.3% (neutral) |
| Heap memory allocation | 1579.9 KB | 959.3 KB | **-39.3%** |

### Large interactive list view (1,000 items)

| Metric | Standard Lit (baseline) | @lit-core/event-hoist | Improvement |
| :--- | ---: | ---: | ---: |
| Native DOM event listeners | 4,000 | 3 | **-99.9%** |
| Component mount latency | 0.79 ms | 0.52 ms | **-34.2% faster** |
| Heap memory allocation | 768.9 KB | 363.2 KB | **-52.8%** |

---

## Running this benchmark

```bash
# Run isolated event-hoist benchmark across all 5 design systems
node packages/benchmarks/src/index.js --tools=event-hoist

# Run the standalone DOM listener allocation harness
pnpm run benchmark:event-hoist
```

---

## Architectural invariants and delegation mechanics

1. **Event bubbling preservation**: Hoisting applies exclusively to bubbling DOM events (`click`, `input`, `keydown`, `keyup`, `focusin`, `focusout`). Non-bubbling events (`scroll`, `load`) remain bound directly.
2. **`event.currentTarget` fidelity**: A synthetic event wrapper preserves standard Lit event semantics, ensuring handlers receive the target child element as `event.currentTarget`.
3. **Clean disposal**: All delegated listeners are scoped to the component's `ShadowRoot` and tear down automatically when the root is disconnected.

---

## Related documentation

- [Benchmark executive overview](../README.md)
- [Event hoist package README](../../event-hoist/README.md)
- [Deferred proxy architecture](./elem-proxy.md)
