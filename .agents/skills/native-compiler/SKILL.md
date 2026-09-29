---
name: native-compiler
description: >-
  Maintain and develop the @lit-core/native AOT vanilla Web Component compiler and micro-runtime.
  Use when modifying AST classification, vanilla code emission, micro-runtime reconciler, or bundler plugins.
---

# `native-compiler` development and maintenance guide

This skill outlines the technical architecture, invariants, and verification workflows for `@lit-core/native`.

## Architecture overview

1. **AST classification (`oxc` 0.151.0)**:
   - Scans JavaScript/TypeScript modules for component classes extending `LitElement`, `ReactiveElement`, or any custom element base class.
   - Inspects AST nodes for complexity indicators:
     - Detects dynamic list directives (`repeat()`, `map()`) and complex conditional logic.
     - Routes leaf components to Mode A (pure vanilla Custom Element).
     - Routes dynamic list components to Mode B (micro-runtime `NativeElement`).
   - Supports override modes via `{ mode: 'vanilla-only' | 'micro-only' | 'auto' }`.

2. **Mode A vanilla compiler (`src/vanilla.rs`, `src/template_parser.rs`)**:
   - Parses template HTML into exact DOM `childNodes` paths.
   - Strips all imports from `lit`, `lit-html`, `lit-element`, and `reactive-element`.
   - Rewrites component class to `class ComponentName extends HTMLElement`.
   - Instantiates constructable stylesheets via `new CSSStyleSheet()` and `replaceSync()`.
   - Injects template cloning (`document.createElement('template')`, `cloneNode(true)`) and `attachShadow({ mode: 'open' })`.
   - Generates getters, setters, and `attributeChangedCallback` for observed attributes.
   - Compiles static bindings to direct text node property mutations (`node.data = val`).
   - Uses `oxc_codegen` for 100% valid AST code generation.

3. **Mode B directive lowering (`src/directive_lower.rs`)**:
   - Replaces high-level Lit directives (`classMap`, `styleMap`, `ifDefined`, `guard`) with inline native JS expressions.
   - Automatically eliminates dead imports from `lit/directives/*` to enable bundler tree-shaking.
   - Preserves full compatibility with LitElement lifecycle for complex components.

4. **Bundler plugin integration**:
   - Integrated into `@lit-core/vite-plugin` (position #5 in pipeline) and `@lit-core/webpack-plugin`.
   - Exposes configuration flag `native: boolean | NativePluginOptions`.

## Non-negotiable invariants

- **Strictly general-purpose**: Never hardcode library-specific heuristics, tag whitelists, or vendor class names. All classification must rely on AST analysis.
- **AST codegen invariant (strictly no string splicing)**: Never use string manipulation (`replace_range`, `insert_str`, manual brace counting, regex, `.find('{')`, raw slice span math) to synthesize or rewrite code. Always manipulate AST nodes with `oxc_allocator` / `AstBuilder` and emit code with `oxc_codegen`.
- **Zero runtime dependencies for Mode A**: Mode A output must have zero runtime dependencies on Lit packages.
- **Zero consumer runtime overhead**: Downstream consumers write standard components and only configure the bundler plugin. Never require manual consumer runtime setup or client loader modules.
- **Micro-runtime budget**: Mode B micro-runtime must remain ≤1.5 KB gzipped.
- **Sentence case documentation**: All documentation, comments, and summaries must use sentence case headings and descriptions.

## Verification procedure

1. Rebuild the native Rust module:
   ```bash
   cargo build --release --manifest-path packages/native/Cargo.toml && cp packages/native/target/release/libnative.dylib packages/native/native.darwin-arm64.node
   ```
2. Build TypeScript runtime types:
   ```bash
   pnpm --filter @lit-core/native run build:ts
   ```
3. Run unit tests:
   ```bash
   npx vitest run packages/native/tests/
   ```
4. Run integration and Playwright test suite:
   ```bash
   npx vitest run packages/tests/src/suites/native.test.ts
   ```
5. Run benchmarks across enterprise design systems:
   ```bash
   node packages/benchmarks/src/native-bench.js
   ```
