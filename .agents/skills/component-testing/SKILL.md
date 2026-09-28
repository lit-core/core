---
name: component-testing
description: >-
  Execute and maintain real component multi-framework Playwright Chromium tests for lit-core.
  Use when testing transforms and features against real component source files from Carbon,
  Spectrum, Web Awesome, Material Web, or Momentum.
---

# Real component testing guide

This skill guides you through executing and expanding the Playwright Chromium test suite in `packages/tests`.

## Philosophy and architecture

All tests in `packages/tests` evaluate real production component source and stylesheet files directly from `node_modules`. Synthetic or hand-rolled toy strings are never used in test assertions.

**Strictly forbidden**:
- Mock component definitions (e.g. `elem-${i}`, `test-card`, or synthetic HTML classes).
- Toy strings or hand-rolled snippets substituting for actual production components.

**Mandatory requirements**:
- Always resolve and test real component definitions directly from the 5 enterprise libraries via `packages/tests/src/components.ts` and `packages/tests/src/fixtures.ts`.
- Every test:
1. Reads actual component source or styles from `node_modules` via `fixtures.ts`
2. Runs the `@lit-core` transform function under test
3. Verifies AST output and metadata
4. Executes the transformed code or applies stylesheets inside real headless Chromium via Playwright

## Design systems under test

The test suite evaluates all real production components from each of the 5 supported enterprise libraries (601 validated components in total):
- Carbon Web Components (`@carbon/web-components`)
- Adobe Spectrum Web Components (`@spectrum-web-components`)
- Web Awesome (`@awesome.me/webawesome`)
- Google Material Web (`@material/web`)
- Cisco Momentum Design (`@momentum-design/components`)

## Execution commands

```bash
# Run all real component tests
pnpm --filter @lit-core/tests test

# Run a specific design system suite
npx vitest run packages/tests/src/suites/carbon.test.ts
npx vitest run packages/tests/src/suites/spectrum.test.ts
npx vitest run packages/tests/src/suites/webawesome.test.ts
npx vitest run packages/tests/src/suites/material.test.ts
npx vitest run packages/tests/src/suites/momentum.test.ts
npx vitest run packages/tests/src/suites/native.test.ts
npx vitest run packages/tests/src/suites/plugins.test.ts
```

## Test registry structure

- `packages/tests/src/components.ts`: Central component registry containing exact file paths for all 5 frameworks
- `packages/tests/src/fixtures.ts`: File resolution, stylesheet discovery, and template extraction utilities
- `packages/tests/src/harness.ts`: Shared Playwright Chromium browser lifecycle and DOM helpers
