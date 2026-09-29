# `css-minifier` benchmark and architectural specification

High-speed native CSS template literal minification powered by Lightning CSS.

---

## Architectural overview and mechanism

`@lit-core/css-minifier` minifies Lit CSS tagged template literals ahead of time:
1. **AST discovery**: Identifies `css` tagged template literals in component definitions using `oxc`.
2. **Lightning CSS minification**: Transforms and compresses raw stylesheet text using `lightningcss`, removing redundant whitespace, comments, and optimizing color values.
3. **Interpolation preservation**: Preserves template expression interpolations without breaking CSS syntax trees.

---

## Running standalone benchmarks

Evaluate `css-minifier` standalone against the 20 canonical components:

```bash
# Run standalone css-minifier against Carbon Web Components
node packages/benchmarks/src/index.js --suite=carbon --tool=css-minifier

# Run standalone css-minifier across all 5 design systems
node packages/benchmarks/src/index.js --tool=css-minifier
```

Results are saved to:
- `packages/benchmarks/results/<suite>/css-minifier.json`

---

## Interactive metrics dashboard

Explore live comparison tables, bundle size deltas in the React benchmark dashboard:

```bash
pnpm run viewer:dev
```
