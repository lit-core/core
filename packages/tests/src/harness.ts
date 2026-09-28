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
}

/**
 * Set up a page with custom HTML, CSS, and scripts in real Chromium DOM.
 */
export async function setupTestPage(options: SetupPageOptions = {}): Promise<Page> {
  const browser = await getTestBrowser();
  const page = await browser.newPage();

  const content = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <script type="importmap">
  {
    "imports": {
      "lit": "https://esm.sh/lit@3.3.3",
      "lit/": "https://esm.sh/lit@3.3.3/"
    }
  }
  </script>
  ${options.css ? `<style>${options.css}</style>` : ''}
  ${options.script ? `<script>${options.script}</script>` : ''}
  ${options.moduleScript ? `<script type="module">${options.moduleScript}</script>` : ''}
</head>
<body>
  <div id="test-root">
    ${options.html || ''}
  </div>
</body>
</html>`;

  await page.setContent(content, { waitUntil: 'domcontentloaded' });
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
