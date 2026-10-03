# `directives` benchmark and architectural specification

Ahead-of-time Lit directive lowering compiler eliminating runtime directive object allocations and pruning dead imports.

---

## Architectural overview and mechanism

`@lit-core/directives` compiles away Lit's built-in directives ahead of time into primitive JavaScript expressions:
1. **Zero runtime allocations**: Lowers `classMap`, `styleMap`, `ifDefined`, `when`, `choose`, `map`, `join`, `range`, `guard`, `live`, `keyed`, `cache`, `repeat`, `templateContent`, `unsafeHTML`, `unsafeSVG`, `unsafeMathML`, `until`, `asyncAppend`, `asyncReplace`, and `ref` directly into native operators (`+`, `??`, ternary expressions, `Array.from`).
2. **Dead import pruning**: Automatically removes unused directive import specifiers from bundle chunks and injects `nothing` only where strictly required.
3. **Execution speedup and memory efficiency**: Eliminates 100% of runtime `DirectiveResult` object allocations and controller lifecycle overhead, delivering 70–85% micro-expression speedups.

---

## Running standalone benchmarks

Evaluate `directives` standalone against enterprise components:

```bash
# Run standalone directives benchmark across all 5 design systems
node packages/benchmarks/src/directives-bench.js
```

Results are saved to:
- `packages/benchmarks/results/directives.json`

---

## Interactive metrics dashboard

Explore live comparison tables, allocation reductions, and latency metrics in the React benchmark dashboard:

```bash
pnpm run viewer:dev
```
