# @lit-core/css-fuse

> High-performance Ahead-of-Time (AOT) Constructable Stylesheet Deduplication Engine & Shadow DOM Scoping Auditor for Lit and Web Components, built with Rust and N-API.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

---

## Overview

`@lit-core/css-fuse` analyzes CSS rules across Lit components, extracts duplicate declaration blocks into shared constructable stylesheet modules (`export const _fused_... = css\`...\``), and updates component `static styles` arrays to adopt shared sheets alongside local overrides while preserving cascade order, specificity, and tree-shaking boundaries.

### Why not utility-class atomization?

Traditional CSS deduplication systems (like Tailwind/Atomizers) rely on parsing HTML templates and rewriting dynamic `class` attributes. In Shadow DOM web component architectures, this approach falls apart:
- Styles are encapsulated inside Shadow Roots; global utility classes cannot penetrate without constructable stylesheet adoption or CSS variables.
- Dynamic template expressions (`classMap`, conditional classes) make static HTML template rewriting fragile and prone to runtime bugs.
- Sub-element selectors (`::slotted()`, `:host()`, `::part()`, `:state()`) cannot be atomized into standard utility classes.

Instead, `@lit-core/css-fuse` operates **strictly on the CSS AST**:
- **0% HTML parsing**: Lit `html\`...\`` templates, JSX, and component classes are never modified.
- **100% Cascade Fidelity**: Shared declarations are prepended before local rules in `static styles = [sharedRule, localStyles]`, allowing local declarations to override shared ones when specificity matches.
- **Constructable Stylesheet Sharing**: Web browsers reuse identical `CSSStyleSheet` instances across multiple shadow roots, saving memory and style compilation cycles.

---

## How It Works

```
1. AST Extraction (Oxc)
   Parse TS/JS source files and extract Lit `css` tagged template literals and `static styles`.

2. Rule Canonicalization (LightningCSS)
   Parse CSS declarations, normalize shorthand properties, sort declarations deterministically,
   and generate blake3 hashes for (context, selector, declaration).

3. Frequency Index & Cluster Engine
   Identify declarations occurring in >= threshold components. Group by exact sharing file profile
   into deterministic shared clusters (_fused_<hash>.js).

4. Local Rule Subtraction
   Subtract all extracted declarations from each component's local stylesheet.
   Retain unique component rules and local overrides.

5. Component AST Rewriting
   Prepend shared module imports and rewrite `static styles` to:
   static styles = [_fused_abc123, css`/* remaining local overrides */`];
   (or static styles = [_fused_abc123]; if all rules were shared).
```

---

## Installation

```bash
# Using pnpm
pnpm add -D @lit-core/css-fuse

# Using npm
npm install --save-dev @lit-core/css-fuse

# Using yarn
yarn add -D @lit-core/css-fuse
```

Pre-built native binaries are distributed via NAPI-RS for:
- macOS (Apple Silicon `aarch64` and Intel `x86_64`)
- Linux (`x86_64-unknown-linux-gnu`)

---

## JavaScript / TypeScript API

```typescript
import { fuse, analyze, auditScoping } from '@lit-core/css-fuse';

// 1. Run full deduplication pass
const result = fuse({
  include: ['packages/components/**/src/**/*.ts', 'src/**/*.ts'],
  exclude: ['**/*.test.ts', '**/node_modules/**'],
  threshold: 2,
  outputDir: '.fused',
  write: false,        // Set true to write files to disk (CLI mode)
  virtualImports: true // Set true to emit `virtual:css-fuse/*` imports
});

console.log(result.stats);
// {
//   filesScanned: 75,
//   stylesExtracted: 75,
//   totalRules: 1001,
//   uniqueRules: 967,
//   rulesDeduped: 212,
//   fusedSheetsCreated: 83,
//   componentsRewritten: 68,
//   bytesSaved: 7420
// }

// 2. Perform scoping audit without rewriting
const diagnostics = auditScoping({
  include: ['src/**/*.ts'],
});

for (const d of diagnostics) {
  console.warn(`${d.severity.toUpperCase()} [${d.code}] ${d.message} (${d.filePath}:${d.line})`);
}
```

### Configuration Options (`FuseConfig`)

| Option | Type | Default | Description |
|---|---|---|---|
| `include` | `string[]` | `['packages/components/**/src/**/*.ts', 'src/**/*.ts']` | Glob patterns for source files |
| `exclude` | `string[]` | `['**/*.test.ts', '**/*.spec.ts', '**/node_modules/**', '**/dist/**']` | Glob patterns to exclude |
| `files` | `string[]` | `undefined` | Explicit list of file paths (overrides glob scanning) |
| `threshold` | `number` | `2` | Minimum number of components sharing a rule to trigger extraction |
| `outputDir` | `string` | `'.fused'` | Directory for generated shared stylesheet files |
| `write` | `boolean` | `false` | Write rewritten components and fused sheets to disk |
| `virtualImports` | `boolean` | `false` | Emit `virtual:css-fuse/*` instead of relative file imports |

### Return Value (`FuseResult`)

```typescript
export interface FuseResult {
  fusedSheets: FusedSheetInfo[];
  rewrittenFiles: RewrittenFileInfo[];
  diagnostics: Diagnostic[];
  stats: FuseStats;
}

export interface FusedSheetInfo {
  id: string;               // e.g. '_fused_abc123'
  fileName: string;         // e.g. '_fused_abc123.js'
  code: string;             // Generated ES module exporting constructable sheet
  rulesCount: number;
  sharedBy: string[];       // File paths sharing this sheet
}

export interface RewrittenFileInfo {
  filePath: string;
  originalCode: string;
  transformedCode: string;  // Rewritten code with prepended imports & static styles
  fusedImports: string[];
}
```

---

## CLI Usage

The package ships with a high-performance standalone binary:

```bash
# Print deduplication statistics without modifying source files
css-fuse stats --threshold 2

# Run Shadow DOM scoping and CSS custom property contract audit
css-fuse audit

# Run deduplication pass and write transformed files directly to disk
css-fuse fuse --write --threshold 2 --output-dir .fused
```

### CLI Flags

```
Commands:
  fuse      Extract duplicate rules, generate fused sheets, and rewrite files
  audit     Audit Shadow DOM scoping and CSS custom property contracts
  stats     Print deduplication statistics without modifying files

Options:
  -i, --include <PATTERNS>     Glob patterns to include
  -e, --exclude <PATTERNS>     Glob patterns to exclude
  -t, --threshold <NUMBER>     Extraction threshold (default: 2)
  -o, --output-dir <DIR>       Output directory for shared sheets (default: .fused)
  -w, --write                  Write transformed files to disk
  -j, --json                   Output results as JSON
  -h, --help                   Print help
```

---

## Shadow DOM Scoping & Contract Audits

`@lit-core/css-fuse` includes built-in static analysis rules to enforce robust Web Component styles:

1. **`W3C_SLOTTED_COMPOUND`**:
   Flags invalid compound selectors within `::slotted()`. According to the W3C CSS Scoping Level 1 specification, `::slotted()` only accepts a single compound selector targeting the top-level slotted node. Descendant/child combinators (e.g., `::slotted(div > span)`) are invalid and ignored by browsers.
2. **`DESIGN_CONTRACT_NO_FALLBACK`**:
   Ensures CSS custom properties consumed via `var()` provide fallback values (e.g., `var(--my-token, #fff)` instead of `var(--my-token)`), guaranteeing visual resilience in standalone micro-frontends or un-themed contexts.

---

## Rust Core Architecture

```
packages/css-fuse/src/
├── bin.rs                   # CLI binary entrypoint (clap)
├── lib.rs                   # NAPI-RS bridge & pipeline orchestration
├── models.rs                # Data structures (FuseConfig, NormalizedRule, etc.)
├── extractor/
│   ├── css_tag_visitor.rs   # Oxc AST visitor extracting `css` templates & static styles
│   ├── import_resolver.rs   # Resolves relative module dependencies
│   └── mod.rs
├── normalizer/
│   ├── canonicalize.rs      # LightningCSS parsing & declaration subtraction
│   ├── hasher.rs            # Deterministic blake3 rule & cluster hashing
│   └── mod.rs
├── cluster/
│   ├── frequency.rs         # Frequency indexing of declarations across files
│   ├── fusion.rs            # Grouping rules by sharing profile
│   └── mod.rs
├── codegen/
│   ├── fused_sheet.rs       # Codegen for shared constructable stylesheet modules
│   ├── rewriter.rs          # Codegen for component imports & static styles array
│   └── mod.rs
└── scoping/
    ├── slotted.rs           # W3C ::slotted() selector scoping validator
    ├── custom_props.rs      # Design token fallback validator
    └── mod.rs
```

---

## License

MIT © Jonathan Rawlings
