# @lit-core/morph-to-react

Ahead-of-time compiler and native React 19 runtime lowering Lit Web Components into React without shipping the Lit runtime.

## Overview

`@lit-core/morph-to-react` transforms standard Lit component source files into native React 19 functional and hosted components ahead of time:
- Eliminates `@lit/reactive-element`, `lit-html`, and `lit` from the client bundle.
- Generates React 19 JSX via AST construction using `oxc` and `AstBuilder`.
- Scopes component CSS via `lightningcss` using `@scope` and React 19 `<style href precedence="default">`.
- Synthesizes `MorphHost` runtime lifecycle, reactive property syncing, slot boundaries, and `ElementInternals` form proxies.
- Emits explicit `@lit/react` fallback wrappers when components require bailout.
- Accelerates rebuilds with a content-hashed BLAKE3 incremental cache.

## Installation

```bash
pnpm add @lit-core/morph-to-react
```

## CLI usage

```bash
morph-to-react build "src/components/*.ts" -o dist/react --emit-css
```

Options:
- `-o, --out-dir <dir>`: Output directory for compiled React components (default: `dist/react`).
- `--suffix <suffix>`: Custom element tag suffix (e.g. `-r`).
- `--emit-css`: Emit separate `.css` files rather than inlined `<style>` tags.
- `--no-dts`: Skip TypeScript `.d.ts` declaration generation.
- `--strip-prefix <prefix>`: Strip component prefix (e.g. `cds-` -> `Button`).
- `--no-cache`: Bypass the incremental compilation cache.

## Vite plugin

```ts
import { morphLit } from '@lit-core/morph-to-react/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [
    morphLit({
      tagSuffix: '-r',
      emitCss: true,
    }),
  ],
});
```

## Architecture

| Tier          | Characteristics                                               | Output                                                  |
| :------------ | :------------------------------------------------------------ | :------------------------------------------------------ |
| Tier 0 pure   | Leaf elements without state, lifecycle, or `this` escape      | Pure React functional component, zero runtime, RSC safe |
| Tier 1 hosted | Stateful properties, lifecycle effects, DOM queries, events   | `MorphHost` class, `useMorphHost` hook, forwardRef      |
| Tier 2 facade | Slot projection inspection, form controls, `ElementInternals` | Tier 1 plus `<slot-boundary>` and proxy `<input>`       |
| Bailout       | Unsupported dynamic patterns                                  | Fallback wrapper wrapping original custom element       |
