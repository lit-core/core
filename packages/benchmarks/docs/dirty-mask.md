# Runtime re-render benchmark: dirty-mask

Evaluates template expression evaluations, part diff comparisons, component re-render latency, and memory allocation when 1 property changes out of 10+ bindings across component instances.

## Core optimization mechanism

In standard Lit, updating a reactive property causes `this.render()` to re-evaluate every expression quasi, allocate a fresh values array, and compare every part sequentially.
`@lit-core/dirty-mask` introduces dependency bitmasks synthesized ahead of time:
- Each reactive property is mapped to a bit index (e.g. `1 << 0`, `1 << 1`).
- Expressions in `html` template literals are wrapped with bitmask checks: `${(this.__litDirtyMask & mask) ? (expr) : noChange}`.
- When an unaffected property's bit is `0`, the expression returns Lit's native `noChange` sentinel symbol, skipping part diffing and DOM mutation.

## Summary of results

### Medium dashboard grid (500 instances, 12 bindings, 1 mutated property)

| Metric | Standard Lit (baseline) | @lit-core/dirty-mask | Improvement |
| :--- | ---: | ---: | ---: |
| Template expression evaluations | 6,000 | 500 | **-91.7%** |
| Part diff comparisons | 6,000 | 500 | **-91.7%** |
| Component re-render latency | 0.08 ms | 0.19 ms | **123.8%** |
| Heap memory allocation | 84.4 KB | 73.5 KB | **-13.0%** |

### High-density component tree (1,000 instances, 12 bindings, 1 mutated property)

| Metric | Standard Lit (baseline) | @lit-core/dirty-mask | Improvement |
| :--- | ---: | ---: | ---: |
| Template expression evaluations | 12,000 | 1,000 | **-91.7%** |
| Part diff comparisons | 12,000 | 1,000 | **-91.7%** |
| Component re-render latency | 0.09 ms | 0.15 ms | **60.2%** |
| Heap memory allocation | 141.2 KB | 134.1 KB | **-5.0%** |

