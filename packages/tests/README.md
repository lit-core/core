# `@lit-core/tests`

> Exhaustive Playwright Chromium test suite verifying `@lit-core` optimizations against real production component code from 5 major enterprise design systems.

---

## Overview

Unlike synthetic unit tests, this test suite reads actual production component source and stylesheet files directly from `node_modules`, executes `@lit-core` transforms on real code, and verifies browser hydration and rendering inside real headless Chromium via Playwright.

| Feature under test | Package | Test file | Tests |
| :--- | :--- | :--- | ---: |
| CSS deduplication | [`@lit-core/css-fuse`](../css-fuse/README.md) | `src/css-fuse.test.ts` | 260 |
| Decorator lowering | [`@lit-core/props-lower`](../props-lower/README.md) | `src/props-lower.test.ts` | 255 |
| CSS minification | [`@lit-core/css-minifier`](../css-minifier/README.md) | `src/css-minifier.test.ts` | 255 |
| HTML minification | [`@lit-core/html-minifier`](../html-minifier/README.md) | `src/html-minifier.test.ts` | 255 |
| Static HTML/SVG clustering | [`@lit-core/html-fuse`](../html-fuse/README.md) | `src/html-fuse.test.ts` | 260 |
| Lazy element proxies | [`@lit-core/elem-proxy`](../elem-proxy/README.md) | `src/elem-proxy.test.ts` | 255 |
| ShadowRoot event delegation | [`@lit-core/event-hoist`](../event-hoist/README.md) | `src/event-hoist.test.ts` | 255 |
| Ahead-of-time template compilation | [`@lit-core/html-aot`](../html-aot/README.md) | `src/html-aot.test.ts` | 255 |
| Resumable SSR and hydration | [`@lit-core/resumable`](../resumable/README.md) | `src/resumable.test.ts` | 255 |
| Total | 9 packages | 9 files | 2,305 |

---

## Evaluated design systems

Each feature is evaluated against 51 production components from each of the following 5 libraries (255 components per feature):

1. **Carbon Web Components** (`@carbon/web-components`): IBM design system components.
2. **Adobe Spectrum Web Components** (`@spectrum-web-components`): Adobe design system components.
3. **Web Awesome** (`@awesome.me/webawesome`): Next-generation Web Awesome component suite.
4. **Google Material Web** (`@material/web`): Google Material 3 Web Component implementation.
5. **Cisco Momentum Design** (`@momentum-design/components`): Cisco collaboration design system components.

---

## Running the tests

Run the entire real component test suite:

```bash
pnpm --filter @lit-core/tests test
```

Or run an individual feature test file:

```bash
npx vitest run packages/tests/src/css-fuse.test.ts
```

---

## Related documentation

- [Monorepo benchmark suite](../benchmarks/README.md)
- [Monorepo architecture guidelines](../../AGENTS.md)
- [Contributing guide](../../CONTRIBUTING.md)
