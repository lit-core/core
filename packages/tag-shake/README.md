# `@lit-core/tag-shake`

Ahead-of-time (AOT) dead code elimination compiler pass and bundler optimization for Web Component applications.

---

## Overview

Web Component libraries (such as IBM Carbon Web Components, Adobe Spectrum Web Components, and Web Awesome / Shoelace) register custom elements via global side effects (`customElements.define('my-tag', MyClass)` or `MyClass.define('my-tag')`). Standard bundlers treat global custom element registrations as unshakeable side effects. When an application imports from a component library entry or barrel module, the bundler is forced to retain every single component class, template, and stylesheet in the production bundle, bloating vendor chunks by 200–400 KB.

`@lit-core/tag-shake` eliminates unreferenced custom elements at build time with zero heuristics, zero hardcoded library prefixes, and zero opinionated folder paths:

1. **Application tag scanning**: Analyzes application templates to extract the exact set of custom element tag names actually referenced across the project.
2. **Semantic symbol resolution**: Identifies component registration patterns (`customElements.define`, `Component.define`, `@customElement`), semantically traces the component identifier to its import declaration, and verifies whether the class has any remaining references or public exports.
3. **AST side-effect pruning**: Purges the registration statement and unreferenced imports directly at the AST level using `oxc_allocator` and `AstBuilder`.
4. **Natural tree-shaking**: Downstream bundlers (Rollup, Vite, Webpack) then prune the unreferenced component classes, styles, and dependencies from production chunks.

---

## Architectural principles and invariants

1. **Strictly general purpose**:
   - Zero hardcoded tag prefixes (`cds-*`, `sp-*`, `wa-*`, `md-*`).
   - Zero opinionated directory structures or component path assumptions.
   - Operates identically across any Web Component library.
2. **Identify by meaning, not spelling**:
   - Semantic symbol binding resolution traces imported identifiers to their canonical declaration.
   - Never relies on regex or substring searches.
3. **Structure in, structure out**:
   - Manipulates the AST directly with `AstBuilder` and emits clean code via `oxc_codegen`.
   - Never uses string concatenation or re-parsing.
4. **Prove it or leave it alone**:
   - Dynamic tag registrations (e.g. `customElements.define(prefix + '-btn', Cls)`) are safely detected, causing the transform to bail out cleanly and leave the file untouched.
   - Exported or locally referenced classes are preserved, dropping only the dead registration call.

---

## Installation

```bash
pnpm add -D @lit-core/tag-shake
```

---

## Usage

```typescript
import { scanTags, transformTagShake } from '@lit-core/tag-shake';

// 1. Scan templates for referenced tags
const usedTags = scanTags(`
  import { html } from 'lit';
  const tmpl = html\`<cds-button>Click me</cds-button>\`;
`);

// 2. Shake dead registrations from library modules
const result = transformTagShake(librarySourceCode, {
  usedTags,
  filename: 'vendor.js',
});

console.log(result.code);
console.log('Removed tags:', result.removedTags);
console.log('Preserved tags:', result.preservedTags);
```
