# `dom-paths` benchmark and architectural specification

Ahead-of-time structural DOM path compiler eliminating TreeWalker mounting traversal.

---

## Architectural overview and mechanism

`@lit-core/dom-paths` precomputes structural DOM child index access paths for dynamic template parts:
1. **Tree analysis**: Analyzes the static template HTML hierarchy at compile time.
2. **Direct pointer navigation**: Emits direct parent/child pointer chains (e.g. `root.childNodes[0].childNodes[1]`) instead of executing full DOM TreeWalker traversal passes during component creation.
3. **Mount acceleration**: Significantly reduces CPU instruction count during initial component mounting in high-density DOM trees.

---

## Running standalone benchmarks

Evaluate `dom-paths` standalone against the 20 canonical components:

```bash
# Run standalone dom-paths against Carbon Web Components
node packages/benchmarks/src/index.js --suite=carbon --tool=dom-paths

# Run standalone dom-paths across all 5 design systems
node packages/benchmarks/src/index.js --tool=dom-paths
```

Results are saved to:
- `packages/benchmarks/results/<suite>/dom-paths.json`

---

## Interactive metrics dashboard

Explore live comparison tables, mount latency speedups in the React benchmark dashboard:

```bash
pnpm run viewer:dev
```
