# `@lit-core/resumable`

> Zero-JavaScript SSR and interaction-driven runtime resumption for Lit and Web Component applications.

`@lit-core/resumable` eliminates initial component JavaScript execution on boot by rendering native Declarative Shadow DOM (DSD) on the server, serializing reactive properties into `<script type="lit/state">`, and resuming execution on first user interaction with an inline ~1.2 KB micro-loader.

---

## Key benefits

- **Zero initial component JavaScript**: The browser renders complete, styled Shadow DOM natively with zero component JavaScript downloaded on boot.
- **-99% initial JavaScript download**: Downloads only a ~1.2 KB micro-loader in `<head>` until the user interacts with an element.
- **-98% Total Blocking Time (TBT)**: Eliminates upfront hydration traversals, class instantiations, and marker comment parsing.
- **Zero DOM recreation**: Component upgrade attaches to existing Declarative Shadow DOM nodes with exact reference equality, preventing visual flickers and layout shifts.
- **Seamless event replay**: Replays buffered interaction events (`click`, `keydown`, `input`, etc.) in FIFO order upon module resolution without lost input.
- **Transparent developer experience**: Works with standard Lit components (`@customElement`, `@property`, `html`) without refactoring or proprietary syntax.

---

## Architecture overview

1. **Server side (`@lit-core/resumable/server`)**:
   - Renders components to native Declarative Shadow DOM (`<template shadowrootmode="open">`).
   - Serializes reactive property values into a lightweight snapshot tag (`<script type="lit/state">`).
2. **Client side micro-loader (`@lit-core/resumable/client`)**:
   - Ultra-compact (~1.2 KB) inline script in `<head>`.
   - Intercepts interaction events during the capture phase via `event.composedPath()`.
   - Resolves un-upgraded custom elements against a tag-to-chunk manifest.
3. **Hydration-free adapter (`@lit-core/resumable/client`)**:
   - Adopts existing `this.shadowRoot` without wiping `innerHTML`.
   - Restores property values from the state snapshot and removes the script tag.
   - Binds event listeners to existing nodes without destroying DOM structure.
4. **Event synthesization and replay (`@lit-core/resumable/client`)**:
   - Synthesizes and dispatches replayed events to the original target once the custom element is defined.

---

## Quick usage

### Vite configuration

```typescript
import { defineConfig } from 'vite';
import { lit } from '@lit-core/vite-plugin';

export default defineConfig({
  plugins: [
    lit({
      resumable: {
        preloadOnHover: true,
      },
    }),
  ],
});
```

### Webpack configuration

```javascript
import { lit } from '@lit-core/webpack-plugin';

export default {
  plugins: [
    lit({
      resumable: {
        preloadOnHover: true,
      },
    }),
  ],
};
```

---

## Detailed documentation

- [Resumable benchmark report](../benchmarks/docs/resumable.md)
- [Monorepo benchmark overview](../benchmarks/README.md)
