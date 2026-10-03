---
name: css-fuse-engine
description: >-
  Maintain and develop the css-fuse AST deduplication engine and constructable stylesheet extractor.
  Use when modifying CSS parsing, AST visitors, clustering frequency index, or stylesheet rewriting logic.
---

# `css-fuse` AST deduplication engine guide

This skill outlines the technical invariants, AST visitor mechanics, and verification steps for `@lit-core/css-fuse`.

## Architecture overview

1. **AST extraction (`oxc`)**:
   - Scans JavaScript/TypeScript modules for Lit `css` tagged template expressions (`css\`...\``).
   - Scans CSS `CallExpression` calls where styles are passed as arrays or strings (`css([...])`), essential for libraries like Carbon Web Components.
   - Dynamically tracks imported aliases of the `css` tag (`import { css as o } from '...'`) to correctly match minified library builds (such as Spectrum).

2. **CSS normalization (`lightningcss`)**:
   - Normalizes rules, selectors, and declaration blocks.
   - Computes deterministic hashes (BLAKE3) for declarations to index recurrence frequency across component boundaries.

3. **Cluster creation**:
   - Groups declarations that recur at or above the clustering threshold (default >= 2).
   - Enforces a net-savings calculation to discard tiny micro-clusters where Rollup virtual module import overhead would exceed raw CSS savings.

4. **AST rewriting**:
   - Rewrites component `static styles` to prepend virtual constructable stylesheet references:
     `static styles = [shared_cluster_0, local_component_styles]`
   - Emits virtual module identifiers conforming to `virtual:css-fuse/<hash>.js`.

## Architectural principles and transform standards

This package must strictly adhere to the overarching transform principles in:
`.agents/skills/transform-principles/SKILL.md`

All AST extraction and rewriting must be performed structurally using `oxc_allocator` and `AstBuilder`. Never use regex, string interpolation (`format!`, `push_str`), or re-parsing.

## Non-negotiable invariants

- **Minification awareness**:
  Do not assume the tagged template is named `css`. Always trace tag identifiers via `oxc_semantic` to imports from `"lit"`, `"@lit/reactive-element"`, or `"lit-element"`.
- **Cascade precedence**:
  Shared constructable stylesheets must always be prepended before local overrides. Prepending preserves the cascade order so component-level styles override shared theme defaults without increasing specificity.
- **Selector specificity**:
  Never mutate selectors or strip pseudo-classes in ways that alter specificity or break Shadow DOM boundary encapsulation.
- **Property accessor safety**:
  Ensure that rewritten styles maintain compatibility with `styles.styleSheet` accessors.

## Verification procedure

1. Rebuild the native module:
   ```bash
   cd packages/css-fuse && cargo build --release
   ```
2. Run unit and integration tests:
   ```bash
   node packages/css-fuse/test.js
   ```
3. Test against the benchmark harness to check for deduplication regression:
   ```bash
   pnpm run benchmark:webawesome
   ```
