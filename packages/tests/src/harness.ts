import { type Browser, chromium, type Page } from 'playwright';

let sharedBrowser: Browser | null = null;

/**
 * Get or launch shared real headless Chromium instance via Playwright.
 */
export async function getTestBrowser(): Promise<Browser | null> {
  if (!sharedBrowser || !sharedBrowser.isConnected()) {
    try {
      sharedBrowser = await chromium.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
      });
    } catch {
      sharedBrowser = null;
    }
  }
  return sharedBrowser;
}

/**
 * Close shared Playwright Chromium browser instance.
 */
export async function closeTestBrowser(): Promise<void> {
  if (sharedBrowser) {
    try {
      await sharedBrowser.close();
    } catch {}
    sharedBrowser = null;
  }
}

export interface SetupPageOptions {
  html?: string;
  css?: string;
  script?: string;
  moduleScript?: string;
  bundleCode?: string;
  importMap?: Record<string, string>;
}

/**
 * Set up a page with custom HTML, CSS, and scripts in real Chromium DOM.
 * Executes self-contained bundles and scripts without relying on browser-level
 * bare specifier resolution or external CDN import maps.
 */
export async function setupTestPage(options: SetupPageOptions = {}): Promise<Page> {
  const browser = await getTestBrowser();
  if (!browser) {
    throw new Error('Playwright Chromium browser could not be launched in the current environment.');
  }
  const page = await browser.newPage();

  const importMapTag = options.importMap
    ? `<script type="importmap">
  ${JSON.stringify({ imports: options.importMap }, null, 2)}
  </script>`
    : '';

  const bundleScriptTag = options.bundleCode
    ? `<script type="module">
    window.__registeredTags = [];
    const origDefine = customElements.define;
    customElements.define = function(tag, constructor, opt) {
      if (!window.__registeredTags.includes(tag)) {
        window.__registeredTags.push(tag);
      }
      return origDefine.call(customElements, tag, constructor, opt);
    };
    try {
      ${options.bundleCode}
    } catch (e) {
      console.warn('Bundle execution warning:', e);
    }
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
    await page.waitForFunction(() => (window as any).__bundleReady === true, { timeout: 10000 }).catch(() => {});
  }
  return page;
}

/**
 * Helper to query text content inside shadow DOM.
 */
export async function getShadowText(page: Page, hostSelector: string, innerSelector: string): Promise<string> {
  return page.evaluate(
    ({ host, inner }) => {
      const hostEl = document.querySelector(host);
      if (!hostEl || !hostEl.shadowRoot) return '';
      const target = hostEl.shadowRoot.querySelector(inner);
      return target ? (target.textContent || '').trim() : '';
    },
    { host: hostSelector, inner: innerSelector },
  );
}

/**
 * Helper to get computed style inside shadow DOM.
 */
export async function getShadowComputedStyle(page: Page, hostSelector: string, innerSelector: string, propertyName: string): Promise<string> {
  return page.evaluate(
    ({ host, inner, prop }) => {
      const hostEl = document.querySelector(host);
      if (!hostEl || !hostEl.shadowRoot) return '';
      const target = hostEl.shadowRoot.querySelector(inner);
      if (!target) return '';
      return window.getComputedStyle(target).getPropertyValue(prop);
    },
    { host: hostSelector, inner: innerSelector, prop: propertyName },
  );
}
