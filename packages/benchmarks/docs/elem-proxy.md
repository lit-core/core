# `elem-proxy` benchmark and architectural specification

Ahead-of-time Custom Element proxy stubs for deferred registration and lazy component chunk evaluation.

---

## Architectural overview and mechanism

`@lit-core/elem-proxy` generates lightweight custom element proxy stubs:
1. **Lightweight stub injection**: Injects tiny proxy class stubs into the main entry bundle instead of loading full component implementation classes.
2. **Deferred evaluation**: Delays loading and evaluating heavy component code until an element is actually attached to the live DOM or interacted with.
3. **CPU and memory savings**: Significantly cuts initial bundle execution time and V8 heap memory overhead on pages with hundreds of registered components.

---

## Running standalone benchmarks

Evaluate `elem-proxy` standalone against the 20 canonical components:

```bash
# Run standalone elem-proxy against Carbon Web Components
node packages/benchmarks/src/index.js --suite=carbon --tool=elem-proxy

# Run standalone elem-proxy across all 5 design systems
node packages/benchmarks/src/index.js --tool=elem-proxy
```

Results are saved to:
- `packages/benchmarks/results/<suite>/elem-proxy.json`

---

## Interactive metrics dashboard

Explore live comparison tables, heap memory savings in the React benchmark dashboard:

```bash
pnpm run viewer:dev
```
