# Runtime initialization benchmark: event-hoist

Evaluates native DOM event listener allocations, component mount latency, and memory footprint when hoisting child element listeners to a single delegated listener on ShadowRoot.

## Summary of results

### Virtual data table rows (500 items)

| Metric | Standard Lit (baseline) | @lit-core/event-hoist | Improvement |
| :--- | ---: | ---: | ---: |
| Native DOM event listeners | 2,000 | 3 | **-99.9%** |
| Component mount latency | 0.54 ms | 0.39 ms | **-27.8%** |
| Heap memory allocation | 977.4 KB | 1660.0 KB | **69.8%** |

### Large interactive list view (1000 items)

| Metric | Standard Lit (baseline) | @lit-core/event-hoist | Improvement |
| :--- | ---: | ---: | ---: |
| Native DOM event listeners | 4,000 | 3 | **-99.9%** |
| Component mount latency | 0.60 ms | 0.41 ms | **-31.7%** |
| Heap memory allocation | 0.0 KB | 3629.1 KB | **362910.0%** |

