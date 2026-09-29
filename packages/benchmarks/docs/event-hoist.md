# `event-hoist` benchmark and architectural specification

Ahead-of-time ShadowRoot event delegation eliminating per-node DOM event listeners.

---

## Architectural overview and mechanism

`@lit-core/event-hoist` hoists inline template event listeners (`@click`, `@input`, etc.) to the component's ShadowRoot:
1. **Event binding analysis**: Identifies event listener bindings attached to inner elements inside Lit templates.
2. **ShadowRoot delegation**: Hoists event listeners into a single multiplexed listener on the component `ShadowRoot`, matching targets via precomputed element paths.
3. **Memory footprint reduction**: Reduces native DOM listener registrations by up to ~99%, lowering V8 memory consumption and mount latency.

---

## Running standalone benchmarks

Evaluate `event-hoist` standalone against the 20 canonical components:

```bash
# Run standalone event-hoist against Carbon Web Components
node packages/benchmarks/src/index.js --suite=carbon --tool=event-hoist

# Run standalone event-hoist across all 5 design systems
node packages/benchmarks/src/index.js --tool=event-hoist
```

Results are saved to:
- `packages/benchmarks/results/<suite>/event-hoist.json`

---

## Interactive metrics dashboard

Explore live comparison tables, listener counts in the React benchmark dashboard:

```bash
pnpm run viewer:dev
```
