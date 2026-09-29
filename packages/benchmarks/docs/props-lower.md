# `props-lower` benchmark and architectural specification

Ahead-of-time Lit decorator lowering into static property descriptors and preset deduplication.

---

## Architectural overview and mechanism

`@lit-core/props-lower` lowers TypeScript/JavaScript decorators (`@property`, `@state`) into standard static properties:
1. **Decorator discovery**: Analyzes `@property()` and `@state()` decorator declarations in Lit component classes using `oxc`.
2. **Static lowering**: Lowers decorator metadata into the static `properties` getter or field definition ahead of time.
3. **Polyfill elimination**: Completely eliminates runtime decorator helper functions (`__decorate`, `tslib`), reducing JS bundle overhead and constructor execution cost.
4. **Preset deduplication**: Deduplicates identical property configuration objects (`{ type: String, reflect: true }`) into shared constants.

---

## Running standalone benchmarks

Evaluate `props-lower` standalone against the 20 canonical components:

```bash
# Run standalone props-lower against Carbon Web Components
node packages/benchmarks/src/index.js --suite=carbon --tool=props-lower

# Run standalone props-lower across all 5 design systems
node packages/benchmarks/src/index.js --tool=props-lower
```

Results are saved to:
- `packages/benchmarks/results/<suite>/props-lower.json`

---

## Interactive metrics dashboard

Explore live comparison tables, bundle size deltas in the React benchmark dashboard:

```bash
pnpm run viewer:dev
```
