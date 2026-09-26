# `@lit-core/html-fuse` agent guidelines

This package implements cross-component static template and SVG fragment clustering for Lit applications.

## Technical invariants

1. **Lit template caching semantics**:
   Every shared constructable template emitted into `virtual:html-fuse/*` exports a Lit `html` or `svg` tagged template. Because every referencing component uses the identical `TemplateStringsArray`, lit-html reuses its global `templateCache` entry without re-parsing `innerHTML`.
2. **Safe interpolation**:
   Extracted subtrees must never contain dynamic interpolations (`${...}`). They must be completely static DOM trees.
3. **Deterministic hashing**:
   BLAKE3 hashing computes canonical identifiers ensuring stable builds and reproducible module hashes across runs.
4. **Writing style**:
   Always use sentence case for documentation, comments, and summaries.
