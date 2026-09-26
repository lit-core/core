# Contributing to lit-core

Thank you for your interest in contributing to `@lit-core`. This guide covers how to set up your environment, build native packages, run tests, and submit changes.

---

## Development prerequisites

Ensure you have the following installed:
- Node.js `>= 24`
- `pnpm >= 11`
- Rust toolchain (`rustc`, `cargo`, `rustfmt`, `clippy`) `>= 1.80`

---

## Getting started

1. Clone the repository:
   ```bash
   git clone https://github.com/lit-core/core.git
   cd core
   ```
2. Install workspace dependencies:
   ```bash
   pnpm install
   ```
3. Build all packages and native Rust NAPI bindings:
   ```bash
   pnpm run build
   ```

---

## Development workflow

### Building native Rust packages
Rust crates (`css-fuse`, `props-lower`, `css-minifier`, `html-minifier`) compile native `.node` addons. When editing Rust code in any package under `packages/`:
```bash
# Rebuild native addons
pnpm run build

# Or build a specific package inside its directory
cd packages/css-fuse
cargo build --release
```

### Running tests
```bash
# Run all workspace test suites
pnpm run test

# Run bundler integration tests
node packages/vite-plugin/test/integration.test.js
```

### Formatting and linting
We use Biome for JavaScript/TypeScript and `cargo fmt` / `cargo clippy` for Rust:
```bash
# Check formatting and linting
pnpm run lint

# Automatically format files
pnpm run format

# Check Rust code
cargo fmt --check --manifest-path packages/css-fuse/Cargo.toml
cargo clippy --manifest-path packages/css-fuse/Cargo.toml
```

---

## Pull request guidelines

- Keep pull requests focused on a single change.
- Use sentence case for commit messages and pull request titles (e.g. `feat: implement declaration clustering in css-fuse`).
- Verify that all tests pass and formatting checks succeed before submitting.
- Avoid introducing breaking changes to cascade ordering or constructable stylesheet precedence.
