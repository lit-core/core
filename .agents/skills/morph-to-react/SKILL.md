---
name: morph-to-react
description: >-
  Maintain and develop the @lit-core/morph-to-react ahead-of-time compiler, CLI, Vite plugin, and React 19 runtime.
  Use when lowering Lit Web Components into native React components, modifying AST classification, updating the runtime facade, or running differential benchmarks.
---

# `morph-to-react` development and maintenance guide

This skill outlines the technical architecture, invariants, and verification workflows for `@lit-core/morph-to-react`.

## Architectural overview

`@lit-core/morph-to-react` is an ahead-of-time (AOT) compiler and runtime that lowers Lit components directly into native React 19 components without shipping the Lit runtime (`lit`, `@lit/reactive-element`, `lit-html`).

The system consists of three architectural layers:
1. `crates/lit-analysis`: Shared Rust analysis crate providing semantic Lit import proof, decorator extraction, property modeling, and template intermediate representations.
2. `packages/morph-to-react`: Rust NAPI compiler crate (`morph_to_react`), command line tool (`morph-to-react build`), Vite / Rollup plugin (`morphLit`), and content-hashed incremental build cache.
3. `@lit-core/morph-to-react/runtime`: Micro-runtime providing `MorphHost`, `useMorphHost`, slot partitioning, and `ElementInternals` form controls proxying.

## Classification tiers

Components are statically classified into four execution tiers:

| Tier | Requirements | Output structure | React Server Component compatibility |
| :--- | :--- | :--- | :--- |
| Tier 0 pure | Stateless leaf element, no lifecycle, no host events, no `this` escape | Pure function component, zero runtime | Yes |
| Tier 1 hosted | Stateful reactive properties, supported lifecycle, event dispatch, queries | Class extending `MorphHost` plus forwardRef wrapper | Client component, SSR safe |
| Tier 2 facade | Tier 1 plus slot inspection, form internals, or element facade | Tier 1 plus `<slot-boundary>` and proxy `<input>` | Client component, SSR safe |
| Bailout | Unsupported dynamic constructs, unknown directives, or unproven `this` escape | `@lit/react` wrapper around custom element with diagnostics | Fallback client component |

## Core invariants and standards

### 1. AST codegen invariant
All JavaScript, TypeScript, and JSX code emission must construct AST nodes directly via `oxc_allocator` and `oxc_ast::builder::AstBuilder`, printed through `oxc_codegen`.
- Strictly forbid string interpolation (`format!`, `push_str`).
- Strictly forbid string re-parsing (`Parser::new`).
- Carry over author expressions and template children as AST nodes directly.

### 2. General-purpose neutrality and minification resilience
Compiler transforms must remain 100% general-purpose with zero component-specific or design-system-specific branch logic.
- Resolve bindings semantically via `oxc_semantic` symbol graphs.
- Never rely on author variable names or class names. Component export names derive from proven tag literals.
- Support mangled identifiers, aliased imports, and minified booleans (`!0`, `!1`).

### 3. Scoped CSS and React 19 style hoisting
Component stylesheets are scoped at compile time using `lightningcss`:
- Transform `:host` into `:scope`.
- Donut-scope slot projections with `@scope (<tag>) to (<slot-boundary>)`.
- Emit styles using React 19 `<style href="..." precedence="default">` or write to separate `.css` files via `--emit-css`.

### 4. Controlled component trap prevention
Reactive properties synchronize to `MorphHost` instances only when incoming props differ from the last committed snapshot, preventing infinite render loops and cursor jumps in controlled form inputs.

## Tooling and plugins

### CLI usage (`morph-to-react build`)
```bash
node packages/morph-to-react/src/cli.js build <input-glob> [options]

Options:
  -o, --out-dir <dir>      Output directory (default: dist/react)
  --suffix <suffix>        Tag name suffix (e.g. -r)
  --emit-css               Emit external .css files instead of inlined <style>
  --no-dts                 Disable TypeScript .d.ts emission
  --strip-prefix <prefix>  Strip component prefix (e.g. cds-)
  --target-tier <tier>     Force target tier (Tier0Pure, Tier1Hosted, Tier2HostedWithFacade, Bailout)
  --no-cache               Disable content-hashed incremental build cache
```

### Vite plugin (`morphLit`)
```ts
import { morphLit } from '@lit-core/morph-to-react/vite';

export default {
  plugins: [
    morphLit({
      tagSuffix: '-r',
      emitCss: true,
    }),
  ],
};
```

## Verification procedure

1. Run Rust tests:
   ```bash
   cargo test -p lit_analysis -p morph_to_react
   ```
2. Run Clippy and formatting checks:
   ```bash
   cargo clippy -p morph_to_react -p lit_analysis
   cargo fmt -p morph_to_react -p lit_analysis --check
   ```
3. Rebuild native addon and compile TypeScript declarations:
   ```bash
   node scripts/build-native.mjs morph-to-react --release --tsc
   ```
4. Run package unit tests:
   ```bash
   pnpm --filter @lit-core/morph-to-react test
   ```
5. Run full E2E differential parity suite:
   ```bash
   pnpm --filter @lit-core/tests vitest run src/suites/morph-to-react.test.ts
   ```
6. Run benchmark suite:
   ```bash
   node packages/benchmarks/src/features/morph-to-react.js
   ```
