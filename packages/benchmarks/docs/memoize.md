# Reactive expression auto-memoization benchmark results

Ahead-of-time (AOT) compiler pass analyzing JavaScript AST data flow inside Lit `render()` and automatically wrapping pure array transformations (`.map()`, `.filter()`, `.sort()`, `.slice()`, `.reduce()`) in property-guarded cache slots.

## Overview of benchmark methodology

In standard Lit applications, data transformations declared inside `render()` re-evaluate on every single update cycle—even when the mutated property is completely unrelated to the array pipeline. For large lists and data tables (500+ items), this causes repeated allocations of intermediate arrays and hundreds of `TemplateResult` instances, introducing noticeable V8 garbage collection pauses and forcing child subtree reconciliation.

`@lit-core/memoize` automatically extracts component property dependencies and generates property guards (`this.__memo_*_ref === this.*`). When referenced properties are unchanged, the component immediately returns the cached reference, allowing Lit's `Object.is()` check to skip child subtree reconciliation in 0 milliseconds with 0 allocations.

## Summary of results

### Virtual data table rows during drawer toggle (500 items, 200 unrelated state updates)

| Metric | Standard Lit (baseline) | @lit-core/memoize | Improvement |
| :--- | ---: | ---: | ---: |
| Pipeline re-executions | 201 | 1 | **-99.5%** |
| Array and object allocations | 134,067 | 667 | **-99.5%** |
| Total re-render duration | 2.89 ms | 0.00 ms | **-100.0%** |
| Heap memory allocation | 638.1 KB | 9.6 KB | **-98.5%** |
| Estimated V8 GC pause time | 16.37 ms | 0.01 ms | **-99.9%** |

### Large interactive data grid during unrelated selection (1000 items, 200 unrelated state updates)

| Metric | Standard Lit (baseline) | @lit-core/memoize | Improvement |
| :--- | ---: | ---: | ---: |
| Pipeline re-executions | 201 | 1 | **-99.5%** |
| Array and object allocations | 267,933 | 1,333 | **-99.5%** |
| Total re-render duration | 4.11 ms | 0.00 ms | **-100.0%** |
| Heap memory allocation | 2083.2 KB | 9.4 KB | **-99.5%** |
| Estimated V8 GC pause time | 33.07 ms | 0.01 ms | **-100.0%** |

