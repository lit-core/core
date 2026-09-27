# Runtime initialization benchmark: event-hoist

Evaluates native DOM event listener allocations, component mount latency, and memory footprint when hoisting child element listeners to a single delegated listener on ShadowRoot.

## Summary of results

### Virtual data table rows (500 items)

| Metric | Standard Lit (baseline) | @lit-core/event-hoist | Improvement |
| :--- | ---: | ---: | ---: |
| Native DOM event listeners | 2,000 | 3 | **-99.9%** |
| Component mount latency | 0.48 ms | 0.52 ms | **8.3%** |
| Heap memory allocation | 1579.9 KB | 959.3 KB | **-39.3%** |

### Large interactive list view (1000 items)

| Metric | Standard Lit (baseline) | @lit-core/event-hoist | Improvement |
| :--- | ---: | ---: | ---: |
| Native DOM event listeners | 4,000 | 3 | **-99.9%** |
| Component mount latency | 0.79 ms | 0.52 ms | **-34.2%** |
| Heap memory allocation | 768.9 KB | 3631.7 KB | **372.3%** |

