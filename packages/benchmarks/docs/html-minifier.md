# `html-minifier` benchmark and architectural specification

High-speed native HTML and SVG template literal minification powered by OXC.

---

## Architectural overview and mechanism

`@lit-core/html-minifier` provides high-speed native minification for Lit `html` tagged templates:
1. **AST discovery**: Identifies Lit `html` tagged template literals in component sources using `oxc`.
2. **Whitespace and comment stripping**: Removes redundant HTML whitespace, empty comment markers, and newline padding while preserving whitespace inside preformatted elements (`<pre>`, `<code>`, `<textarea>`).
3. **Attribute compression**: Normalizes and collapses boolean and empty attribute syntax.

---

## Running standalone benchmarks

Evaluate `html-minifier` standalone against the 20 canonical components:

```bash
# Run standalone html-minifier against Carbon Web Components
node packages/benchmarks/src/index.js --suite=carbon --tool=html-minifier

# Run standalone html-minifier across all 5 design systems
node packages/benchmarks/src/index.js --tool=html-minifier
```

Results are saved to:
- `packages/benchmarks/results/<suite>/html-minifier.json`

---

## Interactive metrics dashboard

Explore live comparison tables, bundle size deltas in the React benchmark dashboard:

```bash
pnpm run viewer:dev
```
