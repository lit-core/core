# `@lit-core/memoize` empirical benchmark results

Ahead-of-time reactive template expression memoization evaluated across 5 enterprise collection components to eliminate redundant array transformations and GC overhead during unrelated state updates.

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

## Reactive expression memoization efficiency comparison

Measurements compare standard inline Lit template expressions against `@lit-core/memoize` cached slots across 500-item collection components undergoing 200 unrelated state updates:

| Metric | IBM Carbon | Adobe Spectrum | Web Awesome | Cisco Momentum | Google Material Web |
| :--- | ---: | ---: | ---: | ---: | ---: |
| Collection items rendered | 500 | 500 | 500 | 500 | 500 |
| Unrelated state updates | 200 | 200 | 200 | 200 | 200 |
| Baseline pipeline executions | 201 | 201 | 201 | 201 | 201 |
| Optimized pipeline executions | 1 | 1 | 1 | 1 | 1 |
| Pipeline execution reduction | **-99.5%** | **-99.5%** | **-99.5%** | **-99.5%** | **-99.5%** |
| Baseline object allocations | 50,451 | 50,451 | 50,451 | 50,451 | 50,451 |
| Optimized object allocations | 251 | 251 | 251 | 251 | 251 |
| Allocation reduction | **-99.5%** | **-99.5%** | **-99.5%** | **-99.5%** | **-99.5%** |
| Baseline re-render latency | 2.31 ms | 1.69 ms | 1.83 ms | 1.82 ms | 1.69 ms |
| Optimized re-render latency | 0.03 ms | 0.00 ms | 0.00 ms | 0.00 ms | 0.00 ms |
| Re-render speedup | **-98.7%** | **-100.0%** | **-100.0%** | **-100.0%** | **-100.0%** |
| Baseline estimated GC pause | 0.58 ms | 0.58 ms | 0.58 ms | 0.58 ms | 0.58 ms |
| Optimized estimated GC pause | 0.00 ms | 0.00 ms | 0.00 ms | 0.00 ms | 0.00 ms |
| GC pause reduction | **-100.0%** | **-100.0%** | **-100.0%** | **-100.0%** | **-100.0%** |

> [!NOTE]
> In standard Lit templates, pure collection operations (`.filter()`, `.map()`, `.sort()`) re-execute unconditionally on every render cycle even when their source collections have not mutated. `@lit-core/memoize` creates input-guarded cache slots at build time, returning reference-stable cached arrays and skipping 99.5% of pipeline re-executions.

---

## Memoization diagnostics and cache slot analysis

Detailed cache slot allocations, invalidation checks, and compilation diagnostics across enterprise collection components:

| Design system or library | Target component | Items rendered | Expressions memoized | Cache slots allocated | Invalidation checks | Build overhead |
| :--- | :--- | ---: | ---: | ---: | ---: | :--- |
| IBM Carbon Web Components | `<cds-data-table>` | 500 | 2 | 2 | 200 | Fast native pass |
| Adobe Spectrum Web Components | `<sp-table>` | 500 | 2 | 2 | 200 | Fast native pass |
| Web Awesome | `<wa-select>` | 500 | 2 | 2 | 200 | Fast native pass |
| Cisco Momentum Design | `<mdc-list>` | 500 | 2 | 2 | 200 | Fast native pass |
| Google Material Web | `<md-list>` | 500 | 2 | 2 | 200 | Fast native pass |

---

## Running this benchmark

```bash
node packages/benchmarks/src/memoize-bench.js
```

---

## Architectural highlights and invariants

- **99.5% reduction in pipeline re-executions**: Pure array transformations are skipped entirely during unrelated state mutations.
- **Elimination of transient GC pressure**: Prevents re-allocating thousands of intermediate array and object instances per render cycle.
- **Reference stability for Lit ChildPart**: Returning the cached array reference allows Lit to perform reference equality checks (`Object.is`) and skip DOM reconciliations completely.
- **Input-guarded cache slots**: Cache invalidates only when upstream source inputs mutate by reference.

---

## Related documentation

- [Benchmark executive overview](../README.md)
- [`@lit-core/memoize` package documentation](../../memoize/README.md)
- [Ahead-of-time dirty mask optimization](../docs/dirty-mask.md)
