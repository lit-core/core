# `memoize` benchmark and architectural specification

Ahead-of-time reactive expression auto-memoization eliminating redundant template part recomputation.

---

## Architectural overview and mechanism

`@lit-core/memoize` inspects complex or pure reactive expressions within Lit template bindings:
1. **Purity analysis**: Analyzes pure function calls, array mappings, and object projections embedded in template interpolations.
2. **Compile-time memoization cache**: Generates targeted single-value or shallow-comparison memoization cells for expensive template interpolations.
3. **Sub-millisecond update cycle**: Avoids repeated allocations and DOM reconciliations when upstream dependencies have not changed.

---

## Running standalone benchmarks

Evaluate `memoize` standalone against the 20 canonical components:

```bash
# Run standalone memoize against Carbon Web Components
node packages/benchmarks/src/index.js --suite=carbon --tool=memoize

# Run standalone memoize across all 5 design systems
node packages/benchmarks/src/index.js --tool=memoize
```

Results are saved to:
- `packages/benchmarks/results/<suite>/memoize.json`

---

## Interactive metrics dashboard

Explore live comparison tables, update latency metrics in the React benchmark dashboard:

```bash
pnpm run viewer:dev
```
