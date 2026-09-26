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

## Content guidelines

1. **High signal-to-noise ratio**:
   - Deliver information directly without filler or buzzwords.
   - Do not repeat the same metrics or data points in multiple formats (e.g. table + callout + prose + accordion).
2. **Actionable tables**:
   - Keep table columns concise.
   - Align text left (`:---`) and numeric values right (`---:`).
3. **No historical postmortems in documentation**:
   - Consumer documentation and benchmark docs must describe current behavior and verified metrics, not past bug fix histories or internal debugging notes.
