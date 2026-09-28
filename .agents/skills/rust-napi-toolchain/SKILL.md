---
name: rust-napi-toolchain
description: >-
  Build, compile, test, and troubleshoot native Rust NAPI-RS packages in this monorepo.
  Use when modifying Rust code in css-fuse, props-lower, css-minifier, or html-minifier,
  or when encountering missing native addon (.node) errors.
---

# Rust NAPI-RS development and build workflow

This skill guides you through developing and building native Rust packages with Node.js NAPI-RS bindings in the `@lit-core` monorepo.

## Affected packages
- `packages/native`
- `packages/dom-paths`
- `packages/dirty-mask`
- `packages/event-hoist`
- `packages/memoize`
- `packages/elem-proxy`
- `packages/css-minifier`
- `packages/html-minifier`
- `packages/css-fuse`
- `packages/html-fuse`
- `packages/props-lower`

## AST codegen invariant (strictly no string splicing)

Every Rust transform in this monorepo must adhere strictly to AST-level manipulation:
- **Never splice code**: Strictly prohibit `replace_range`, `insert_str`, manual brace counting, regex search/replace, `.find('{')`, and raw slice span math. String splicing breaks on multiline imports, inline comments, string literals with brackets or braces, and multi-component files.
- **Always use `oxc` AST**: Parse with `oxc_parser`, perform structural transforms on the AST using `oxc_allocator` / `AstBuilder` / `oxc_traverse`, and serialize output using `oxc_codegen`.
- **Preserve syntax validity**: AST transforms are guaranteed syntactically valid and deterministic.

## Building native artifacts

Whenever you modify `.rs` files or Cargo dependencies, you must compile the native bindings before running JavaScript tests, benchmarks, or Vite integration tasks.

### Step-by-step build procedure

1. Navigate to the relevant package or run cargo build directly:
   ```bash
   # From monorepo root or package directory:
   cd packages/<package-name> && cargo build --release
   ```

2. Verify the `.node` binary is present in the package root:
   - For `css-fuse`: `packages/css-fuse/css-fuse.<target>.node`
   - For `props-lower`: `packages/props-lower/props-lower.<target>.node`
   - For `css-minifier`: `packages/css-minifier/css-minifier.<target>.node`
   - For `html-minifier`: `packages/html-minifier/html-minifier.<target>.node`

3. If running via npm scripts:
   ```bash
   pnpm --filter @lit-core/<package-name> run build
   ```

## Testing native modules

1. **Rust unit tests**:
   ```bash
   cargo test --manifest-path packages/<package-name>/Cargo.toml
   ```

2. **Node.js integration tests**:
   Ensure the native `.node` binary has been built first, then run:
   ```bash
   node packages/<package-name>/test.js
   ```

## Common troubleshooting

- **Missing `.node` file error** (`Cannot find module ... .node`):
  Run `cargo build --release` inside the package directory and ensure `index.js` correctly points to the platform-specific `.node` binary.
- **Symbol mismatch or ABI changes**:
  If you changed function signatures exported via `#[napi]`, ensure TypeScript type definitions in `index.d.ts` match the new signatures.
- **Cargo dependency changes**:
  Always update `Cargo.lock` by running `cargo check` after changing `Cargo.toml`.
