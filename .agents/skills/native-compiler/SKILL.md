---
name: native-compiler
description: >-
  Maintain and develop the @lit-core/native AOT vanilla Web Component compiler and micro-runtime.
  Use when modifying AST classification, vanilla code emission, micro-runtime reconciler, or bundler plugins.
---

# `native-compiler` development and maintenance guide

This skill outlines the technical architecture, invariants, and verification workflows for `@lit-core/native`.

## Architectural principles and transform standards

This package must strictly adhere to the overarching transform principles in:
`.agents/skills/transform-principles/SKILL.md`

All AST construction must use `oxc_allocator` and `AstBuilder`. Never use string interpolation (`format!`, `push_str`), string re-parsing (`Parser::new`), or text substring matching (`contains()`, `find()`).

## Classification and decision rules

Classification determines whether a component can safely be transformed into a pure vanilla Custom Element (Mode A), lowered to the micro-runtime (Mode B), or left untouched.

### 1. Proving a component is Lit
- **Semantic identification**: Inspect the class heritage expression. Resolve its symbol binding via `oxc_semantic` to verify that it imports from a known Lit module (`"lit"`, `"@lit/reactive-element"`, `"lit-element"`).
- **Minified resilience**: In minified bundles, `import { LitElement as e } from 'lit'` means the class extends `e`. Never rely on identifier name strings like `"LitElement"` or substring checks like `heritage.contains("Element")`.
- **Bailout**: If the heritage cannot be proven to extend Lit, leave the class untouched.

### 2. Mode A eligibility criteria (pure vanilla Custom Element)
A component may only be transformed to Mode A if **all** of the following conditions are proven:
- All reactive properties use supported standard options (`type`, `reflect`, `attribute`).
- No unsupported Lit lifecycle hooks are defined (`firstUpdated`, `updated`, `willUpdate`, `update`, `shouldUpdate`).
- No host controllers are added (`addController`).
- All template bindings are static or direct property bindings supported by the template compiler.
- No dynamic list directives (`repeat()`, `map()`) or complex conditional branching directives.

### 3. Strict Mode A prohibitions
When compiling to Mode A, the transform must **never**:
- **Patch global prototypes**: Never attach properties or methods to `HTMLElement.prototype`.
- **Inject fake compatibility stubs**: Never generate dummy Lit methods (e.g. `requestUpdate() { return Promise.resolve(false); }` or `static createProperty() {}`) to bypass unhandled features.
- **Invent fallback markup**: Never invent `<slot></slot>` when no template is declared.
- **Guess event names**: Never default unparseable event bindings to `"click"` or strip strings with `trim_start_matches("this.")`. Move original AST handler expressions directly into `addEventListener`.
- **Reconstruct expressions via strings**: Carry over author initializers and expressions as AST nodes (`clone_in`).

### 4. Mode B and safe bailout
- If a component uses dynamic directives or features supported by the micro-runtime, route to Mode B (`NativeElement`).
- If any component feature is unrecognized, dynamic, or unsupported by both Mode A and Mode B, leave the component completely unchanged and emit a diagnostic. An untouched file is a safe, valid outcome.

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
   node packages/benchmarks/src/features/native.js
   ```
