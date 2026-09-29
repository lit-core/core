# `native` benchmark and architectural specification

Ahead-of-time vanilla Web Component and micro-runtime compiler eliminating Lit dependencies for leaf components.

---

## Architectural overview and mechanism

`@lit-core/native` compiles Lit components into dependency-free standard vanilla Web Components:
1. **Component classification**: Analyzes component features (lifecycle hooks, reactive property complexity, directives).
2. **Vanilla code emission**: Emits standard custom element classes using a tiny, shared micro-runtime for reactive property management and DOM updates.
3. **Zero-Lit bundle footprint**: Allows leaf components and design systems to ship with zero dependency on `lit`, `lit-html`, or `@lit/reactive-element`.

---

## Running standalone benchmarks

Evaluate `native` standalone against the 20 canonical components:

```bash
# Run standalone native against Carbon Web Components
node packages/benchmarks/src/index.js --suite=carbon --tool=native

# Run standalone native across all 5 design systems
node packages/benchmarks/src/index.js --tool=native
```

Results are saved to:
- `packages/benchmarks/results/<suite>/native.json`

---

## Interactive metrics dashboard

Explore live comparison tables, bundle size deltas in the React benchmark dashboard:

```bash
pnpm run viewer:dev
```
