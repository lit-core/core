# @lit-core/test-kit

> Sandbox-safe Playwright browser runner and DOM test utilities for Lit and Web Components.

---

## Introduction

### What is it?

`@lit-core/test-kit` provides sandbox-safe Chromium lifecycle management, DOM mounting helpers, Shadow DOM inspection tools, and sourcemap stack trace resolution for Vitest and Playwright test suites across the `@lit-core` monorepo.

### Why does it exist?

Running browser integration tests for Web Components inside restricted CI/CD containers, containerized runners, or developer sandboxes introduces major challenges:
- Standard Chromium launches fail when Linux user namespaces, loopback network socket bindings, or GPU hardware acceleration are restricted.
- Testing Web Components requires deep Shadow DOM traversal (`root.shadowRoot.querySelector(...)`), cross-boundary computed style inspection, and accurate sourcemap error translation.
- Duplicating browser launch flags and Shadow DOM query helpers across test files causes inconsistent timeouts and flaky test runs.

### How does it work?

`test-kit` standardizes browser test execution:
1. Preconfigures Chromium with verified sandbox-safe launch flags (`--single-process`, `--no-sandbox`, `--disable-gpu`, `--disable-dev-shm-usage`).
2. Provides a singleton browser manager (`getSharedBrowser()`, `closeSharedBrowser()`) to avoid expensive browser re-launches between test files.
3. Exposes high-level mounting and Shadow DOM query utilities (`mountElement()`, `getShadowComputedStyle()`, `getShadowText()`).
4. Decodes error stack traces using source maps to point directly to original TypeScript and Lit component files.

---

## Architecture

```mermaid
flowchart TD
    A["Vitest / Playwright test runner"] --> B["test-kit launcher: SANDBOX_SAFE_CHROMIUM_ARGS"]
    B --> C["Headless Chromium process (single-process sandbox mode)"]
    C --> D["Managed test page context (createTestPage)"]
    D --> E["mountElement: instantiate element, apply props, wait for updateComplete"]
    E --> F["Shadow DOM inspection: assertMounted, getShadowComputedStyle, getShadowText"]
    F --> G["Assertion evaluation & sourcemap error translation (mapStackTrace)"]
```

### In-depth technical details

#### 1. Sandbox-safe browser flags

`SANDBOX_SAFE_CHROMIUM_ARGS` includes:
- `--single-process`: Avoids multi-process fork and macOS sandbox Mach port rendezvous restrictions.
- `--no-sandbox` & `--disable-setuid-sandbox`: Disables Linux namespace isolation requirements.
- `--disable-dev-shm-usage`: Uses `/tmp` instead of `/dev/shm` to avoid container memory limits.
- `--disable-gpu`: Disables hardware acceleration dependencies.
- `--enable-precise-memory-info` & `--js-flags=--expose-gc`: Enables deterministic heap memory measurement and manual garbage collection during tests.

#### 2. Shadow DOM inspection utilities

- `createTestPage(browser, options)`: Creates or reuses an isolated test page with `pageerror` and `console` error listeners, optional inline `bundleCode`, `importMap`, `html`, and `css`, returning a `ManagedTestPage` (`{ page, errors, getErrors, clearErrors, close }`).
- `mountElement(page, tagName, props)`: Creates an instance of `tagName`, assigns `props`, appends it to `#test-root` (or `document.body`), awaits `el.updateComplete`, and returns a `MountResult` (`{ tag, success, hasShadowRoot, childElementCount, renderedText, updateCompleteMs, error }`).
- `assertMounted(result)`: Verifies that a `MountResult` succeeded, created a shadow root, and rendered child elements.
- `getShadowComputedStyle(page, hostSelector, innerSelector, propertyName)`: Pierces the host component's Shadow DOM to read computed CSS values directly from encapsulated nodes.
- `getShadowText(page, hostSelector, innerSelector)`: Extracts text content from encapsulated elements inside shadow roots.

---

## Installation

```bash
pnpm add -D @lit-core/test-kit
```

---

## Usage

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  assertMounted,
  closeSharedBrowser,
  createTestPage,
  getShadowComputedStyle,
  getSharedBrowser,
  mountElement,
} from '@lit-core/test-kit';

describe('Button component integration', () => {
  let browser;
  let managed;

  beforeAll(async () => {
    browser = await getSharedBrowser();
    managed = await createTestPage(browser, {
      html: '<my-button label="Submit"></my-button>',
    });
  });

  afterAll(async () => {
    await managed?.close();
    await closeSharedBrowser();
  });

  it('mounts and styles button in Shadow DOM', async () => {
    const result = await mountElement(managed.page, 'my-button', { label: 'Submit' });
    assertMounted(result);

    const display = await getShadowComputedStyle(managed.page, 'my-button', 'button', 'display');
    expect(display).toBe('inline-flex');
  });
});
```

---

## Cross references

- Real component test suite: [`@lit-core/tests`](../tests/README.md)
- Benchmark harness: [`@lit-core/benchmarks`](../benchmarks/README.md)
- Monorepo guidelines: [Monorepo architecture](../../../AGENTS.md)

---

## License

MIT
