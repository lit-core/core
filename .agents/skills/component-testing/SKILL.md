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

Every test:
1. Reads actual component source or styles from `node_modules` via `fixtures.ts`
2. Runs the `@lit-core` transform function under test
3. Verifies AST output and metadata
4. Executes the transformed code or applies stylesheets inside real headless Chromium via Playwright

## Design systems under test

The test suite tests 51 real components from each of the 5 supported enterprise libraries:
- Carbon Web Components (`@carbon/web-components`)
- Adobe Spectrum Web Components (`@spectrum-web-components`)
- Web Awesome (`@awesome.me/webawesome`)
- Google Material Web (`@material/web`)
- Cisco Momentum Design (`@momentum-design/components`)

## Execution commands

```bash
# Run all 2,305 real component tests
pnpm --filter @lit-core/tests test

# Run a specific feature test file
npx vitest run packages/tests/src/css-fuse.test.ts
npx vitest run packages/tests/src/props-lower.test.ts
npx vitest run packages/tests/src/css-minifier.test.ts
npx vitest run packages/tests/src/html-minifier.test.ts
npx vitest run packages/tests/src/html-fuse.test.ts
npx vitest run packages/tests/src/elem-proxy.test.ts
npx vitest run packages/tests/src/event-hoist.test.ts
npx vitest run packages/tests/src/html-aot.test.ts
npx vitest run packages/tests/src/resumable.test.ts
```

## Test registry structure

- `packages/tests/src/components.ts`: Central component registry containing exact file paths for all 5 frameworks
- `packages/tests/src/fixtures.ts`: File resolution, stylesheet discovery, and template extraction utilities
- `packages/tests/src/harness.ts`: Shared Playwright Chromium browser lifecycle and DOM helpers
