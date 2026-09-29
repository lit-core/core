# `@lit-core/benchmarks`

> Empirical bundle size, build overhead, and runtime performance benchmarks for `@lit-core` across production Lit design systems.

The `@lit-core/benchmarks` package provides an empirical benchmark framework and interactive dashboard evaluating `@lit-core` optimizations against standard Vite production builds (**Baseline**) across 5 major enterprise design systems:
- **Carbon Web Components** (`@carbon/web-components`)
- **Spectrum Web Components** (`@spectrum-web-components/bundle`)
- **Web Awesome** (`@awesome.me/webawesome`)
- **Material Web** (`@material/web`)
- **Momentum Design** (`@momentum-design/components`)

---

## Canonical component parity architecture

To ensure fair, apples-to-apples comparisons across all design systems, benchmarks evaluate an identical handpicked set of **20 canonical UI components** representing a standard enterprise application dashboard:
`button`, `checkbox`, `radio`, `switch`, `text-input`, `select`, `dialog`, `badge`, `tabs`, `progress-bar`, `spinner`, `slider`, `menu`, `divider`, `icon`, `icon-button`, `card`, `avatar`, `accordion`, and `breadcrumb`.

Every component is resolved from production package exports, guaranteeing uniform test surface across all suites.

---

## Interactive React benchmark viewer

All benchmark results are interactively explored via the dedicated React viewer application:

```bash
# Start the interactive benchmark viewer in development mode
pnpm run viewer:dev

# Build the static production viewer with relative paths for GitHub Pages
pnpm run viewer:build

# Preview the static production build locally
pnpm run viewer:preview
```

### Dashboard capabilities
- **Overview matrix**: Cross-library heatmap table comparing all 5 design systems against all optimization features.
- **Library deep dive**: Filter by design system, inspecting baseline bundle size vs each optimization delta with visual bar charts.
- **Feature deep dive**: Inspect a specific compiler pass across all 5 libraries alongside AST diagnostics.
- **Tested components**: Comprehensive cross-library mapping table of all 20 canonical UI concepts and their respective custom element tags.
- **Raw JSON inspector**: Formatted JSON inspection for every standalone benchmark output with copy and download utilities.
- **Zero bundled data**: The dashboard loads all benchmark metrics dynamically via runtime `fetch('./results/manifest.json')` and `fetch('./results/<suite>/<feature>.json')` with strictly zero hardcoded data.

---

## Running benchmarks

Every feature and baseline can be evaluated in isolation, producing dedicated JSON and HTML showcase artifacts:

```bash
# Run standalone benchmark for a specific library and tool
node packages/benchmarks/src/index.js --suite=carbon --tool=baseline
node packages/benchmarks/src/index.js --suite=carbon --tool=css-fuse
node packages/benchmarks/src/index.js --suite=carbon --tool=html-aot

# Run all features for a single design system
pnpm run benchmark:carbon
pnpm run benchmark:spectrum
pnpm run benchmark:webawesome
pnpm run benchmark:material
pnpm run benchmark:momentum

# Run a specific feature across all design systems
node packages/benchmarks/src/index.js --tool=css-fuse
node packages/benchmarks/src/index.js --tool=props-lower
node packages/benchmarks/src/index.js --tool=all

# Run the complete benchmark matrix across all libraries and tools
pnpm run benchmark:all
```

---

## Standalone JSON artifacts

Each benchmark execution writes decoupled standalone outputs to `packages/benchmarks/results/`:
- `results/manifest.json`: Index manifest recording libraries, features, and run summaries.
- `results/<suite>/<feature>.json`: Detailed metrics (raw bytes, gzip bytes, brotli bytes, build time, first render mount latency, deltas, and AST diagnostics).

---

## Dedicated per-package architectural guides

Architecture and compiler specifications are documented per package:

- [**`css-fuse` architecture**](docs/css-fuse.md): Cross-component CSS AST deduplication and constructable stylesheets.
- [**`html-fuse` architecture**](docs/html-fuse.md): Static HTML and SVG fragment clustering and consolidated innerHTML parsing.
- [**`props-lower` architecture**](docs/props-lower.md): AOT decorator lowering, prototype scalar hoisting, and descriptor preset deduplication.
- [**`event-hoist` architecture**](docs/event-hoist.md): Ahead-of-time ShadowRoot event delegation eliminating per-node event listeners.
- [**`dom-paths` architecture**](docs/dom-paths.md): Structural child pointer paths eliminating TreeWalker mounting traversal.
- [**`dirty-mask` architecture**](docs/dirty-mask.md): Property-to-part dependency bitmasking eliminating dirty-checking loops.
- [**`memoize` architecture**](docs/memoize.md): Ahead-of-time reactive expression auto-memoization.
- [**`elem-proxy` architecture**](docs/elem-proxy.md): Deferred element proxy stubs and lazy chunk evaluation.
- [**`html-aot` architecture**](docs/html-aot.md): Ahead-of-time Lit template compilation eliminating runtime prepare overhead.
- [**`native` architecture**](docs/native.md): Ahead-of-time pure vanilla Custom Element compilation with micro-runtime.
- [**`css-minifier` architecture**](docs/css-minifier.md): High-speed Lightning CSS template minification.
- [**`html-minifier` architecture**](docs/html-minifier.md): High-speed OXC HTML and SVG template minification.
- [**`resumable` architecture**](docs/resumable.md): Zero-JavaScript Declarative Shadow DOM SSR and interaction-driven resumption.
