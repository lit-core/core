# `html-fuse` benchmark and architectural specification

Cross-component static HTML and SVG fragment clustering into shared virtual template modules.

---

## Architectural overview and mechanism

`@lit-core/html-fuse` identifies identical or repeated HTML/SVG subtrees across different Lit component templates:
1. **AST template traversal**: Parses Lit `html` tagged templates using `oxc`.
2. **Structural fragment clustering**: Clusters static subtrees (such as SVG icon paths, common container structures, or button wrappers) based on configurable size and frequency thresholds.
3. **Consolidated virtual extraction**: Hoists extracted static subtrees into shared virtual modules, reducing repeated template string byte footprint across large suites.

---

## Running standalone benchmarks

Evaluate `html-fuse` standalone against the 20 canonical components:

```bash
# Run standalone html-fuse against Carbon Web Components
node packages/benchmarks/src/index.js --suite=carbon --tool=html-fuse

# Run standalone html-fuse across all 5 design systems
node packages/benchmarks/src/index.js --tool=html-fuse
```

Results are saved to:
- `packages/benchmarks/results/<suite>/html-fuse.json`

---

## Interactive metrics dashboard

Explore live comparison tables, bundle size deltas in the React benchmark dashboard:

```bash
pnpm run viewer:dev
```
