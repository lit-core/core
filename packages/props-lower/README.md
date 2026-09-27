# `@lit-core/props-lower`

> Native Rust AST lowering of Lit decorators and reactive properties to static properties ahead of time.

`@lit-core/props-lower` transforms Lit TypeScript decorators (`@customElement`, `@property`, `@state`, `@query`) into standard static class `properties` fields ahead of time, eliminating runtime reflection and decorator polyfills.

---

## Key benefits

- **Zero runtime reflection**: Eliminates runtime decorator polyfills (such as `tslib` helpers) from client bundles.
- **Fast native execution**: Powered by Rust and `oxc` for microsecond-level AST transforms.
- **Spec-compliant output**: Generates standard Lit static `properties` compatible with all modern JavaScript bundlers.

---

## Installation

```bash
pnpm add -D @lit-core/props-lower
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
      propsLower: true,
    }),
  ],
});
```

---

## Detailed documentation

- [Transform mechanics and supported decorators](docs/transform-mechanics.md)
- [Deferred Custom Element proxy architecture](../elem-proxy/docs/proxy-architecture.md)
- [props-lower benchmark report](../benchmarks/docs/props-lower.md)
- [Monorepo benchmark overview](../benchmarks/README.md)
