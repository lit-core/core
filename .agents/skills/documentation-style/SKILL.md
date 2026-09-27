---
name: documentation-style
description: >-
  Enforce writing style, formatting standards, and casing rules across documentation and text.
  Use when writing, drafting, or editing any documentation, READMEs, table headers,
  summaries, comments, or agent responses in this monorepo.
---

# Documentation and writing style guide

This skill enforces clarity, brevity, and formatting conventions across the `@lit-core` monorepo.

## Mandatory casing rule: use sentence case

Whenever writing text or documentation, **do NOT uppercase every single word**.

- ❌ Avoid Title Case:
  - Do NOT write: `Detailed Breakdown Of Component Rules`
  - Do NOT write: `Optimization Tool / Mode`
  - Do NOT write: `Shared Constructable Sheets Created`
  - Do NOT write: `Evaluated Design Systems And Libraries`
- ✅ Always use sentence case:
  - Write: `Detailed breakdown of component rules`
  - Write: `Optimization tool or mode`
  - Write: `Shared constructable sheets created`
  - Write: `Evaluated design systems and libraries`

### Where this rule applies:
1. Markdown headings (`#`, `##`, `###`, etc.)
2. Table column headers
3. List items and bullet points
4. Callout titles and admonitions
5. Commit messages and pull request descriptions
6. Responses and explanations provided to the user

### Exceptions
Preserve proper nouns, established brand names, acronyms, and code identifiers exactly:
- `Lit`, `Vite`, `Rollup`, `TypeScript`, `Rust`
- `oxc`, `lightningcss`, `NAPI-RS`, `BLAKE3`
- `Carbon Web Components`, `Spectrum Web Components`, `Web Awesome`, `Material Web`
- `CSSStyleSheet`, `TaggedTemplateExpression`, `CallExpression`, `Shadow DOM`

## Monorepo README structure rules

Follow the design pattern of world-class open-source monorepos (e.g. Vite, Biome, Turborepo):

1. **Root `README.md` must remain lean and high-level**:
   - **No getting started walkthroughs or bash install commands**: Delegate installation, prerequisites, and developer scripts to `CONTRIBUTING.md`.
   - **No mermaid diagrams or architecture flowcharts in root**: Flowcharts belong in dedicated architecture documents under package `docs/`.
   - **No verbose motivational walls of text**: State the purpose and problem-solution concisely in 1-2 paragraphs.
   - **Concise packages table**: List package names with direct links to package READMEs and architecture guides.
   - **Concise benchmark summary**: High-level table with direct links to dedicated per-package benchmark reports.
2. **Package README cross-linking**:
   - Each package README must link directly to its dedicated benchmark report (`../benchmarks/docs/<package>.md`) as well as the monorepo benchmark overview (`../benchmarks/README.md`).
   - Cross-link related packages and architecture guides directly.

## Punctuation and phrasing rules

1. **Strictly NO em dashes (`—` or `--`)**:
   - Never use em dashes (`—` or `--`) in prose, titles, or tables.
   - Use standard hyphens `-`, parentheses `(...)`, or direct phrasing.
   - For empty or not-applicable table cells, use `n/a` or `-`, never `—`.
2. **Zero filler words and AI slop text**:
   - Strictly avoid marketing buzzwords: "seamlessly", "cutting-edge", "game-changing", "revolutionary", "elevate", "unparalleled", "crucial", "testament", "delve".
   - Keep prose punchy, factual, and direct.
3. **No redundant or repetitive blocks**:
   - Avoid re-stating the exact same numbers in multiple consecutive formats (e.g. table followed by callouts followed by bullet points).
   - Keep table alignments consistent: left-align text (`:---`), right-align numbers (`---:`).
4. **No historical postmortems in consumer documentation**:
   - Documentation must describe current behavior and verified metrics, not past bug fix histories or internal debugging notes.
