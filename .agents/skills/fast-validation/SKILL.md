---
name: fast-validation
description: >-
  Fast autonomous testing and validation workflow for agents in the lit-core monorepo.
  Use when validating Rust transforms, JS plugins, or real components inside standard sandbox mode.
---

# Fast autonomous validation guide

This skill outlines how agents validate code changes rapidly and autonomously inside the standard sandbox with zero permission prompts.

## Tiered fail-fast check loop

Always test in small increments, progressing from cheapest to most expensive:

1. **Tier 0: format and lint (~1s)**
   ```bash
   pnpm run lint
   ```
2. **Tier 1: native Rust tests (~0.3s per crate)**
   ```bash
   # Test only affected crates
   pnpm run check:rust

   # Or test a single crate directly
   cargo test --manifest-path packages/<crate>/Cargo.toml
   ```
3. **Tier 2: JavaScript unit tests (~1–3s)**
   ```bash
   pnpm run check:js
   ```
4. **Tier 3: fast component verification (~1–3s)**
   ```bash
   # Verify a specific component in sandboxed Chromium
   pnpm run verify --suite=carbon --component=button

   # Verify an entire canonical suite
   pnpm run verify --suite=carbon
   pnpm run verify --suite=spectrum
   ```
5. **Combined automated runner**:
   ```bash
   # Automatically detects affected crates and packages from git diff
   pnpm run check

   # Run across all packages
   pnpm run check:all
   ```

## Sandbox invariants for browser execution

- **Never launch browsers directly**:
  Always use `@lit-core/test-kit` (`launchBrowser`, `getSharedBrowser`, `createTestPage`).
  Test kit includes verified `--single-process` and `--no-sandbox` flags that run hermetically inside the standard macOS sandbox.
- **Never start local HTTP servers**:
  Loopback network connections (`127.0.0.1`) are restricted by the sandbox and fail with `connect EPERM`.
  Always inject bundles and HTML content using `setContent()` or inline script modules.
- **Never search inside node_modules**:
  Deep pnpm hardlink trees trigger heavy background tasks.
  Use `pnpm run vendor:where <suite> [component]` to resolve exact component source files and tags instantly.

## Workflow from browser failure to general-purpose resolution

When a component fails during browser verification or benchmarks:
1. **Inspect error**: Check the captured error report at `artifacts/verify/<suite>/<component>/error.log`.
2. **Isolate fixture**: Extract the minimal failing AST pattern and save it as a fixture in `packages/<crate>/tests/fixtures/<name>.js`.
3. **Formulate the general rule**: What standard JavaScript, HTML, CSS, or Lit specification behavior was unhandled? Never ask "how do I make this specific component pass?" Ask "what general AST construct did the parser or transform encounter?"
4. **Create adversarial and minified variants**: Add a second fixture variant with mangled identifier names, aliased imports (`import { property as p }`), or minified syntax (`!0` for booleans) to ensure the solution is robust against minification.
5. **Fix the AST transform**: Implement the fix structurally in Rust using `oxc_allocator` and `AstBuilder`. Strictly forbid any check for component names, tags, suite namespaces, or ad hoc string matching. Refer to `.agents/skills/transform-principles/SKILL.md`.
6. **Verify both variants**: Run `cargo test --manifest-path packages/<crate>/Cargo.toml`. Both the original and adversarial fixtures must pass.
7. **Verify suite**: Re-run `pnpm run check:rust` followed by `pnpm run verify --suite=<suite> --component=<component>`.
