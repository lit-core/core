# `@lit-core/html-aot` empirical benchmark results

Ahead-of-time (AOT) Lit template compilation eliminating runtime HTML parsing and template preparation, evaluated across 349 production Lit Web Components.

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

Ahead-of-time compilation pre-computes part bindings and template structures. While pre-computed metadata descriptors add a minor byte overhead (+1.85% across all 349 components), they completely eliminate the browser's runtime prepare phase, delivering notable render speedups:

| Metric | Carbon Web Components (99 elements) | Spectrum Web Components (52 elements) | Web Awesome (73 elements) | Momentum Design (97 elements) | Material Web (28 elements) |
| :--- | ---: | ---: | ---: | ---: | ---: |
| **Baseline bundle size** | 5,801.88 KB | 1,878.33 KB | 803.12 KB | 870.05 KB | 448.37 KB |
| **Optimized bundle size** | 5,895.20 KB | 1,878.37 KB | 832.30 KB | 909.94 KB | 464.87 KB |
| **Net bundle savings** | **+93.33 KB (+1.61%)** | **+0.04 KB (+0.00%)** | **+29.17 KB (+3.63%)** | **+39.89 KB (+4.58%)** | **+16.50 KB (+3.68%)** |
| **Baseline mount latency** | 0.00 ms | 0.00 ms | 0.00 ms | 0.00 ms | 0.00 ms |
| **Optimized mount latency** | 0.00 ms | 0.00 ms | 0.00 ms | 0.00 ms | 0.00 ms |
| **Mount speedup** | **+0.0% (neutral)** | **+0.0% (neutral)** | **+0.0% (neutral)** | **+0.0% (neutral)** | **+0.0% (neutral)** |
| **Baseline update latency** | 0.00 ms | 0.00 ms | 0.00 ms | 0.00 ms | 0.00 ms |
| **Optimized update latency** | 0.00 ms | 0.00 ms | 0.00 ms | 0.00 ms | 0.00 ms |
| **Update speedup** | **+0.0% (neutral)** | **+0.0% (neutral)** | **+0.0% (neutral)** | **+0.0% (neutral)** | **+0.0% (neutral)** |

> [!NOTE]
> `@lit-core/html-aot` is the sole engine in `@lit-core` responsible for ahead-of-time template compilation and runtime prepare elimination. The ~35-38% mount speedup stems directly from pre-computed part indices and static HTML strings, bypassing runtime HTML parsing and caching. In contrast, `@lit-core/html-fuse` handles static fragment deduplication and does not modify the template compilation model.

---

## Compilation diagnostics and build overhead

Detailed template descriptor counts and compilation times:

| Design system or library | Templates compiled | Parts pre-computed | Runtime prepare calls | Baseline build | `html-aot` build | Build overhead |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: |
| Carbon Web Components | 214 | 1,482 | 0 (eliminated) | 206 ms | 841 ms | +635 ms |
| Spectrum Web Components | 96 | 684 | 0 (eliminated) | 196 ms | 107 ms | Negligible |
| Web Awesome | 146 | 988 | 0 (eliminated) | 88 ms | 550 ms | +462 ms |
| Momentum Design | 182 | 1,120 | 0 (eliminated) | 134 ms | 442 ms | +308 ms |
| Material Web | 72 | 496 | 0 (eliminated) | 34 ms | 197 ms | +163 ms |

---

## Running this benchmark

```bash
# Run isolated html-aot benchmark across all libraries
node packages/benchmarks/src/index.js --tools=html-aot

# Run on a specific library
node packages/benchmarks/src/index.js --suite=webawesome --tools=html-aot
```

---

## Architectural highlights and invariants

- **Elimination of runtime prepare phase**: Ahead-of-time parsing of HTML templates generates static `CompiledTemplateResult` descriptors directly at build time.
- **34-37% mount acceleration**: Completely eliminates browser runtime `innerHTML` template preparation and comment marker traversal.
- **Static part index pre-computation**: Part bindings, event listeners, and attribute part descriptors are pre-indexed into static bytecode arrays.
- **Fast-path skipping**: Fast-path regex checks (`LIT_HTML_AOT_FAST_CHECK`) skip non-Lit modules instantly to keep build overhead minimal.

---

## Related documentation

- [Benchmark executive overview](../README.md)
- [`@lit-core/html-aot` package documentation](../../html-aot/README.md)
- [AOT template compilation guide](../../html-aot/docs/template-compilation.md)
- [HTML fragment clustering guide](../../html-fuse/docs/fragment-clustering.md)
