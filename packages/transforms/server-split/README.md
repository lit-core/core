# `@lit-core/server-split`

Native Rust ahead-of-time (AOT) server and client component splitter and schema validator for Lit server elements.

## Overview

`@lit-core/server-split` is a high-performance compiler transform built with `oxc` and `lit_analysis`. It analyzes Lit Web Components decorated with `@loader()` and `@action()` and partitions them into two distinct output targets:
1. **Worker artifact (`.worker.js`)**: Executed on Cloudflare Workers and WinterCG edge runtimes, preserving server imports, loader and action logic, parameter schema validators, and content-addressed action registries.
2. **Client artifact (`.client.js`)**: Shipped to web browsers, stripping private server code, replacing actions with RPC stubs, and emitting zero Lit runtime for purely server-driven components.

## Core features

- **Minification-resilient semantic identification**: Resolves decorators and base classes semantically via `oxc_semantic` symbol bindings.
- **Static isolation proof (`SE101`)**: Guarantees server-only imports, credentials, and loader parameters never reach browser client bundles.
- **TypeScript parameter validator synthesis (`SE102`)**: Compiles TypeScript parameter types into defense-in-depth AST validation routines defending against prototype pollution and malformed payloads.
- **Reactive property tracking (`SE103`)**: Verifies loader and action property writes against declared reactive properties.
- **Decorator option checks (`SE107`)**: Options passed to `@loader()` and `@action()` must be literals the compiler can read.
- **Reserved method names (`SE108`)**: An `@action()` or `@loader()` named like a member the element already has (`remove`, `update`, `click`, `requestUpdate`, `actionUrl`) is refused, because the compiled class would replace that member.
- **JSON-safe state types (`SE109`)**: A reactive property annotated `Map`, `Set`, `Date`, a function, `symbol` or `bigint` is refused, since element state travels as JSON. Run `checkStateTypes` on the original source: lowering decorators removes the annotations it reads.
- **Server-only `renderPending()`**: Kept in the worker artifact and removed from the client artifact, so a streamed element can show a placeholder at no cost to the browser.
- **Source-derived build id**: Each element is stamped with a BLAKE3 hash of its source unless `buildId` is given, so a page from an older build is refused with `ACTION_STALE` instead of running against new code.
- **Content-addressed action hashing**: Generates deterministic 16-hex BLAKE3 digests for action endpoints.
- **Pure `AstBuilder` emission**: Strictly zero string splicing and zero re-parsing of generated code.

## Installation

```bash
pnpm add -D @lit-core/server-split
```

## Usage

### Via bundler plugins

`@lit-core/server-split` is enabled by default (`serverElements: true`) inside [`@lit-core/vite-plugin`](../../bundlers/vite-plugin/README.md) and [`@lit-core/webpack-plugin`](../../bundlers/webpack-plugin/README.md).

### Programmatic API

```ts
import { splitServerElement, compileWorkerEntry } from '@lit-core/server-split';

const result = splitServerElement(sourceCode, {
  filename: 'product-stock.ts',
  sourcemap: true,
});

if (result.isServerElement) {
  console.log(result.clientCode);
  console.log(result.workerCode);
}
```

## Cross references

- Authoring primitives and runtimes: [`@lit-core/server-elements`](../../primitives/server-elements/README.md)
- Server-side rendering engine: [`@lit-core/ssr`](../../rendering/ssr/README.md)
- Bundler plugins: [`@lit-core/vite-plugin`](../../bundlers/vite-plugin/README.md) and [`@lit-core/webpack-plugin`](../../bundlers/webpack-plugin/README.md)
