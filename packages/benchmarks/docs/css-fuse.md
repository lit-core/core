# `css-fuse` benchmark and architectural specification

Cross-component CSS AST deduplication into shared constructable stylesheets evaluated across production Lit design systems.

---

## Architectural overview and mechanism

`@lit-core/css-fuse` performs ahead-of-time CSS AST deduplication across component boundaries:
1. **AST extraction**: Parses component styles at the AST level using `oxc` and `lightningcss`.
2. **Declaration block hashing**: Identifies identical CSS rules and declaration blocks across different component modules.
3. **Constructable stylesheet extraction**: Extracts shared CSS rules into hash-addressed virtual modules (`virtual:css-fuse/*`) exporting Lit `css` tagged template strings.
4. **Browser stylesheet sharing**: In the browser, shared sheets instantiate a single `CSSStyleSheet` instance in memory shared across all component shadow roots.

---

## Core invariants and constraints

- **Cascade and specificity preservation**: Shared constructable stylesheets are prepended before component local overrides in `static styles = [sharedSheet, localOverrides]`. Local specificity and cascade order are strictly preserved.
- **Net-savings threshold**: Enforces a configurable byte savings threshold to ensure virtual module import overhead never exceeds CSS bytes saved.
- **Strictly general purpose**: Never relies on library-specific class name, tag, or component whitelists. Operates purely on valid CSS AST structures.

---

## Running standalone benchmarks

Evaluate `css-fuse` standalone against the 20 canonical components:

```bash
# Run standalone css-fuse against Carbon Web Components
node packages/benchmarks/src/index.js --suite=carbon --tool=css-fuse

# Run standalone css-fuse across all 5 design systems
node packages/benchmarks/src/index.js --tool=css-fuse
```

Results are saved to:
- `packages/benchmarks/results/<suite>/css-fuse.json`

---

## Interactive metrics dashboard

Explore live comparison tables, bundle size deltas, AST diagnostics in the React benchmark dashboard:

```bash
pnpm run viewer:dev
```

Or view the static production dashboard deployed on GitHub Pages.
