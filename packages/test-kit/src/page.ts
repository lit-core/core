import type { Browser, Page } from 'playwright';

export interface SetupPageOptions {
  html?: string;
  css?: string;
  script?: string;
  moduleScript?: string;
  bundleCode?: string;
  bundleName?: string;
  importMap?: Record<string, string>;
  timeoutMs?: number;
  reusePage?: boolean;
}

export interface ManagedTestPage {
  page: Page;
  errors: string[];
  getErrors: () => string[];
  clearErrors: () => void;
  close: () => Promise<void>;
}

let sharedTestPageInstance: Page | null = null;

export async function getSharedTestPage(browser: Browser): Promise<Page> {
  if (!sharedTestPageInstance || sharedTestPageInstance.isClosed() || !browser.isConnected()) {
    sharedTestPageInstance = await browser.newPage();
  }
  return sharedTestPageInstance;
}

/**
 * Create an isolated test page with attached error listeners and optional DOM structure.
 */
export async function createTestPage(browser: Browser, options: SetupPageOptions = {}): Promise<ManagedTestPage> {
  const shouldReuse = options.reusePage !== false;
  const page = shouldReuse ? await getSharedTestPage(browser) : await browser.newPage();
  const errors: string[] = [];

  const pageErrorHandler = (err: Error) => {
    errors.push(`[Page error] ${err.stack || err.message}`);
  };
  const consoleHandler = (msg: any) => {
    if (msg.type() === 'error') {
      errors.push(`[Console error] ${msg.text()}`);
    }
  };

  page.on('pageerror', pageErrorHandler);
  page.on('console', consoleHandler);

  if (shouldReuse) {
    try {
      await page.goto('about:blank');
    } catch {}
  }

  const importMapTag = options.importMap
    ? `<script type="importmap">
  ${JSON.stringify({ imports: options.importMap }, null, 2)}
  </script>`
    : '';

  const bundleName = options.bundleName || 'bundle.js';
  const bundleScriptTag = options.bundleCode
    ? `<script>
    window.__registeredTags = [];
    window.__registrationMs = 0;
    window.__bundleError = null;

    const origDefine = customElements.define;
    customElements.define = function(tag, constructor, opt) {
      if (!window.__registeredTags.includes(tag)) {
        window.__registeredTags.push(tag);
      }
      const t0 = performance.now();
      const result = origDefine.call(customElements, tag, constructor, opt);
      window.__registrationMs += performance.now() - t0;
      return result;
    };

    window.__evalStart = performance.now();
    window.addEventListener('error', function(e) {
      window.__bundleError = (e.error && e.error.stack) || e.message;
    });
  </script>
  <script type="module">
${options.bundleCode}
//# sourceURL=${bundleName}
  </script>
  <script type="module">
    window.__evalEnd = performance.now();
    window.__bundleReady = true;
  </script>`
    : '';

  const content = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  ${importMapTag}
  ${options.css ? `<style>${options.css}</style>` : ''}
  ${options.script ? `<script>${options.script}</script>` : ''}
  ${options.moduleScript ? `<script type="module">${options.moduleScript}</script>` : ''}
  ${bundleScriptTag}
</head>
<body>
  <div id="test-root">
    ${options.html || ''}
  </div>
</body>
</html>`;

  await page.setContent(content, { waitUntil: 'domcontentloaded' });

  if (options.bundleCode) {
    const timeout = options.timeoutMs ?? 15000;
    await page.waitForFunction(() => (window as any).__bundleReady === true, { timeout }).catch(() => {});
  }

  return {
    page,
    errors,
    getErrors: () => [...errors],
    clearErrors: () => {
      errors.length = 0;
    },
    close: async () => {
      page.off('pageerror', pageErrorHandler);
      page.off('console', consoleHandler);
      if (!shouldReuse) {
        try {
          await page.close();
        } catch {}
      } else {
        try {
          await page.goto('about:blank');
        } catch {}
      }
    },
  };
}

/**
 * Query text content inside a custom element's shadow root.
 */
export async function getShadowText(page: Page, hostSelector: string, innerSelector: string): Promise<string> {
  return page.evaluate(
    ({ host, inner }) => {
      const hostEl = document.querySelector(host);
      if (!hostEl?.shadowRoot) return '';
      const target = hostEl.shadowRoot.querySelector(inner);
      return target ? (target.textContent || '').trim() : '';
    },
    { host: hostSelector, inner: innerSelector },
  );
}

/**
 * Query computed style property inside a custom element's shadow root.
 */
export async function getShadowComputedStyle(page: Page, hostSelector: string, innerSelector: string, propertyName: string): Promise<string> {
  return page.evaluate(
    ({ host, inner, prop }) => {
      const hostEl = document.querySelector(host);
      if (!hostEl?.shadowRoot) return '';
      const target = hostEl.shadowRoot.querySelector(inner);
      if (!target) return '';
      return window.getComputedStyle(target).getPropertyValue(prop);
    },
    { host: hostSelector, inner: innerSelector, prop: propertyName },
  );
}
