# `@lit-core/html-fuse`

AOT cross-component static template and SVG fragment clustering engine for Lit and Web Components.

## Overview

In Lit, `lit-html` caches compiled `<template>` elements in a global `Map<TemplateStringsArray, Template>` keyed by the frozen template literal strings array. Across large component suites (Carbon Web Components, Adobe Spectrum, Web Awesome, Material Web), components duplicate dozens of identical static HTML and SVG subtrees (e.g. icon definitions, caret chevrons, focus rings, slot wrappers, and helper text containers).

`@lit-core/html-fuse` mirrors `css-fuse` for HTML and SVG templates:
- Scans `html` and `svg` tagged template literals across all components using high-speed AST visitors in native Rust (`oxc`).
- Identifies identical static DOM subtrees and full static templates.
- Extracts shared subtrees into hash-addressed virtual modules (`virtual:html-fuse/*`) exporting Lit `html` and `svg` tagged template expressions.
- Rewrites component template literals, replacing duplicate inline markup with interpolations of the shared virtual template.

### Runtime memory and parsing impact

Because every component references the identical `TemplateStringsArray` from the shared virtual module, the browser only parses the `<template>` element with `innerHTML` once and allocates one shared `Template` cache entry in memory across the entire application.

## Installation

```bash
pnpm add -D @lit-core/html-fuse
```

## Programmatic API

```typescript
import { fuse, analyze, auditTemplates } from '@lit-core/html-fuse';

const result = fuse({
  include: ['src/**/*.ts'],
  threshold: 2,
  minFragmentLength: 15,
});

console.log(`Deduplicated ${result.stats.fragmentsDeduped} static fragments into ${result.stats.fusedTemplatesCreated} shared templates`);
```

## Options

| Option | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `include` | `string[]` | `['packages/components/**/src/**/*.ts', 'src/**/*.ts']` | Glob patterns for component source files to scan |
| `exclude` | `string[]` | `['**/*.test.ts', '**/*.spec.ts', '**/node_modules/**', '**/dist/**']` | Glob patterns to exclude from scanning |
| `threshold` | `number` | `2` | Minimum number of components sharing a fragment to trigger clustering |
| `minFragmentLength` | `number` | `15` | Minimum character length of static fragment to qualify for clustering |
| `outputDir` | `string` | `'.fused-html'` | Directory for generated template files |
| `virtualImports` | `boolean` | `true` | Emit virtual module identifiers (`virtual:html-fuse/*`) |
