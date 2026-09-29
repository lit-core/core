# `html-aot` benchmark and architectural specification

Ahead-of-time Lit template compilation eliminating browser runtime template preparation and HTML parsing.

---

## Architectural overview and mechanism

`@lit-core/html-aot` transforms Lit `html` tagged templates into static `CompiledTemplateResult` descriptors ahead of time:
1. **Ahead-of-time parsing**: Parses HTML markup at compile time using `parse5`, analyzing part locations, attributes, and text node bindings.
2. **Prepared template descriptor**: Emits static template records with pre-computed part indices and compiled strings, completely bypassing Lit's runtime `prepareTemplate` step and HTML string sanitization.
3. **Substantial mount speedup**: Delivers upwards of ~35-44% faster initial component render mount speed in real browser engines.

---

## Running standalone benchmarks

Evaluate `html-aot` standalone against the 20 canonical components:

```bash
# Run standalone html-aot against Carbon Web Components
node packages/benchmarks/src/index.js --suite=carbon --tool=html-aot

# Run standalone html-aot across all 5 design systems
node packages/benchmarks/src/index.js --tool=html-aot
```

Results are saved to:
- `packages/benchmarks/results/<suite>/html-aot.json`

---

## Interactive metrics dashboard

Explore live comparison tables, render mount speedups in the React benchmark dashboard:

```bash
pnpm run viewer:dev
```
