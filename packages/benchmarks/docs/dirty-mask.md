# `dirty-mask` benchmark and architectural specification

Ahead-of-time property-to-part dependency bitmasking eliminating runtime dirty-checking loops.

---

## Architectural overview and mechanism

`@lit-core/dirty-mask` analyzes template expression dependencies at compile time:
1. **Dependency bitmasking**: Analyzes property accesses within Lit template dynamic parts and assigns a unique bitmask flag per reactive property.
2. **Targeted part execution**: When a reactive property changes, only the exact template parts linked to that property's bitmask flag are updated.
3. **Dirty-checking elimination**: Eliminates full-template expression evaluation sweeps on small property updates.

---

## Running standalone benchmarks

Evaluate `dirty-mask` standalone against the 20 canonical components:

```bash
# Run standalone dirty-mask against Carbon Web Components
node packages/benchmarks/src/index.js --suite=carbon --tool=dirty-mask

# Run standalone dirty-mask across all 5 design systems
node packages/benchmarks/src/index.js --tool=dirty-mask
```

Results are saved to:
- `packages/benchmarks/results/<suite>/dirty-mask.json`

---

## Interactive metrics dashboard

Explore live comparison tables, update latency metrics in the React benchmark dashboard:

```bash
pnpm run viewer:dev
```
