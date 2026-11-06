# lit-core

[![CI](https://github.com/lit-core/core/actions/workflows/ci.yml/badge.svg)](https://github.com/lit-core/core/actions/workflows/ci.yml)
[![Deploy](https://github.com/lit-core/core/actions/workflows/deploy-pages.yml/badge.svg)](https://lit-core.github.io/core/)
[![Benchmarks](https://img.shields.io/badge/benchmarks-dashboard-10b981?style=flat)](https://lit-core.github.io/core/)
[![Node.js version](https://img.shields.io/badge/node-%3E%3D26-339933?logo=node.js&style=flat)](https://nodejs.org)
[![Rust toolchain](https://img.shields.io/badge/rust-stable-dea584?logo=rust&style=flat)](https://www.rust-lang.org)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

`@lit-core` is an ahead-of-time Rust compiler and rendering toolchain for Lit and Web Components.

Web Components give teams browser-native style and DOM encapsulation, but standard builds pay for that isolation in the browser. Each component carries its own copy of shared styles, parses HTML templates at runtime, walks the DOM to wire bindings, and downloads client JavaScript before server-rendered markup can respond to user input. Sharing those components across non-Lit applications usually means maintaining wrapper layers that still ship two runtimes.

`@lit-core` moves that work to the build step. Developers write standard Lit components once, and the compiler optimizes styles and templates across the module graph, strips unused code, and outputs smaller Lit bundles, standalone Custom Elements, native components for other frameworks, or streaming server-rendered HTML that wakes up on interaction.

## Capabilities

### Bundle and runtime optimization

Deduplicates repeated Shadow DOM stylesheets and static markup across components into shared constructable sheets and reusable fragments. Precompiles templates, lowers decorators and directives, delegates events, and shakes unused custom element registrations so browsers ship less code and mount components with minimal main-thread work.

### Server streaming and resumability

Streams Declarative Shadow DOM directly from Node.js and edge workers. Server-only data loaders and actions are split out of client bundles at build time, while interactive components remain dormant as pure HTML and CSS until a user interacts with them.

### Cross-target compilation

Compiles Lit components into standalone vanilla Custom Elements or native framework components (such as React 19) when shipping the Lit runtime is unnecessary.

### Drop-in bundler integration

Integrates directly into Vite, Rollup, and Webpack. Existing Lit codebases get whole-graph compilation, chunk-aware stylesheet sharing, and server/client asset coordination without changing component code or adding manual runtime glue.

## Benchmarks and verification

Compiler passes and runtimes are tested against production component libraries including Carbon Web Components, Spectrum Web Components, Web Awesome, Material Web, and Cisco Momentum.

- [Interactive benchmark dashboard and showcase](https://lit-core.github.io/core/)
- [Benchmark harness and results](packages/internal/benchmarks/README.md)
- [Browser verification suite](packages/internal/tests/README.md)

## Documentation

- [Architecture guidelines and invariants](AGENTS.md)
- [Contributing guide](CONTRIBUTING.md)

## License

MIT
