# `@lit-core/elem-proxy`

> Ahead-of-time compiler transform replacing eager Custom Element registrations with lightweight proxy stubs.

`@lit-core/elem-proxy` defers heavy Lit class evaluation, reactive property setups, and constructable stylesheet instantiation until an element is actually mounted in the DOM or touched via JavaScript.

---

## Key benefits

- **-72% script evaluation CPU time**: Avoids executing unrendered element classes during initial script evaluation.
- **-70% V8 heap memory**: Drastically lowers initial heap consumption for component libraries.
- **Full prototype fidelity**: Transparently preserves `instanceof` checks and property accessors with zero layout shifts.

---

## Installation

```bash
pnpm add -D @lit-core/elem-proxy
```

---

## Quick usage

Via `@lit-core/vite-plugin`:
```typescript
import { defineConfig } from 'vite';
import { lit } from '@lit-core/vite-plugin';

export default defineConfig({
  plugins: [
    lit({
      elemProxy: {
        include: 'node_modules/@carbon/web-components/**/*.js',
      },
    }),
  ],
});
```

---

## Detailed documentation

- [Proxy stub architecture and JIT upgrade mechanics](docs/proxy-architecture.md)
- [Props lowering mechanics](../props-lower/docs/transform-mechanics.md)
- [elem-proxy benchmark report](../benchmarks/docs/elem-proxy.md)
- [Monorepo benchmark overview](../benchmarks/README.md)
