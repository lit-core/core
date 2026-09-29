# `resumable` benchmark and architectural specification

Zero-JavaScript Declarative Shadow DOM SSR and interaction-driven runtime resumption.

---

## Architectural overview and mechanism

`@lit-core/resumable` provides zero-JavaScript server-side rendering and resumption for Lit components:
1. **Declarative Shadow DOM SSR**: Emits native `<template shadowrootmode="open">` markup on the server, producing instantly visible UI with zero initial client-side JavaScript.
2. **Resumable event delegation**: Intercepts user interactions via a tiny inline event delegate script before component JavaScript loads.
3. **On-demand resumption**: Defers hydrating and loading component logic until the user actually interacts with that specific component.

---

## Running standalone benchmarks

Evaluate `resumable` standalone against the 20 canonical components:

```bash
# Run standalone resumable against Carbon Web Components
node packages/benchmarks/src/index.js --suite=carbon --tool=resumable

# Run standalone resumable across all 5 design systems
node packages/benchmarks/src/index.js --tool=resumable
```

Results are saved to:
- `packages/benchmarks/results/<suite>/resumable.json`

---

## Interactive metrics dashboard

Explore live comparison tables, Total Blocking Time metrics in the React benchmark dashboard:

```bash
pnpm run viewer:dev
```
