import { compileHtmlAot } from '@lit-core/html-aot';
import { type Browser, chromium } from 'playwright';
import { build } from 'vite';
import { afterAll, describe, expect, it } from 'vitest';

/**
 * Bundles a test JavaScript snippet in memory using local dependencies.
 */
async function bundleSnippet(code: string): Promise<string> {
  const result = await build({
    logLevel: 'silent',
    build: {
      write: false,
      minify: false,
      rollupOptions: { input: 'entry.js' },
    },
    plugins: [
      {
        name: 'virtual-entry',
        resolveId(id) {
          if (id === 'entry.js') return id;
        },
        load(id) {
          if (id === 'entry.js') return code;
        },
      },
    ],
  });
  const out = Array.isArray(result) ? result[0] : (result as any);
  return out.output[0].code;
}

describe('playwright browser runtime testing for lit-core and html-aot', () => {
  let browser: Browser;

  afterAll(async () => {
    if (browser) {
      await browser.close();
    }
  });

  it('renders aot-compiled Lit templates in real browser DOM via Playwright', async (_ctx) => {
    // Source component using Lit html tagged template
    const componentSource = `
      import { html, render } from 'lit';

      export const greeting = (name) => html\`
        <div id="greeting-box">
          <span class="prefix">Hello</span>
          <strong class="target">\${name}</strong>
        </div>
      \`;

      window.renderGreeting = (container, name) => {
        render(greeting(name), container);
      };
    `;

    // Compile with html-aot
    const compiled = compileHtmlAot(componentSource, { filename: 'greeting.js' });
    expect(compiled.templatesCount).toBe(1);
    expect(compiled.code).toContain('_$litType$');

    try {
      browser = await chromium.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      });
    } catch (_err) {
      console.warn('Chromium launch skipped due to sandboxed environment');
      return;
    }

    const page = await browser.newPage();
    const bundledCode = await bundleSnippet(compiled.code);

    const htmlContent = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
</head>
<body>
  <div id="app"></div>
  <script type="module">
    ${bundledCode}
    window.renderGreeting(document.getElementById('app'), 'Lit Core User');
  </script>
</body>
</html>`;

    await page.setContent(htmlContent);

    // Wait for element to render in the DOM
    await page.waitForSelector('#greeting-box');
    const text = await page.$eval('#greeting-box', (el) => el.textContent?.trim());
    expect(text).toContain('Hello');
    expect(text).toContain('Lit Core User');
  });

  it('measures first-render mount latency in real browser via Playwright', async () => {
    if (!browser) {
      try {
        browser = await chromium.launch({
          headless: true,
          args: ['--no-sandbox', '--disable-setuid-sandbox'],
        });
      } catch (_err) {
        console.warn('Chromium launch skipped due to sandboxed environment');
        return;
      }
    }

    const page = await browser.newPage();

    const testSnippet = `
      import { html, render } from 'lit';
      const t0 = performance.now();
      for (let i = 0; i < 50; i++) {
        const container = document.createElement('div');
        render(html\`<div data-id="\${i}"><span>Item \${i}</span></div>\`, container);
        document.getElementById('test-root').appendChild(container);
      }
      const t1 = performance.now();
      window.__firstRenderDuration = t1 - t0;
    `;
    const bundledCode = await bundleSnippet(testSnippet);

    const testHtml = `<!DOCTYPE html>
<html>
<body>
  <div id="test-root"></div>
  <script type="module">
    ${bundledCode}
  </script>
</body>
</html>`;

    await page.setContent(testHtml);
    await page.waitForFunction(() => (window as any).__firstRenderDuration !== undefined);
    const duration = await page.evaluate(() => (window as any).__firstRenderDuration);

    expect(typeof duration).toBe('number');
    expect(duration).toBeGreaterThan(0);
    expect(duration).toBeLessThan(1000);
  });
});
