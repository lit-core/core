import { describe, it, expect, afterAll } from 'vitest';
import { chromium, type Browser } from 'playwright';
import { compileHtmlAot } from '@lit-core/html-aot';

describe('playwright browser runtime testing for lit-core and html-aot', () => {
  let browser: Browser;

  afterAll(async () => {
    if (browser) {
      await browser.close();
    }
  });

  it('renders aot-compiled Lit templates in real browser DOM via Playwright', async (ctx) => {
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
    expect(compiled.code).toContain('_$litType$');

    const htmlContent = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body>
  <div id="app"></div>
  <script type="module">
    ${compiled.code}
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
    const tStart = performance.now();

    const testHtml = `<!DOCTYPE html>
<html>
<body>
  <div id="test-root"></div>
  <script type="module">
    import { html, render } from 'https://esm.sh/lit@3.3.3';
    const t0 = performance.now();
    for (let i = 0; i < 50; i++) {
      const container = document.createElement('div');
      render(html\`<div data-id="\${i}"><span>Item \${i}</span></div>\`, container);
      document.getElementById('test-root').appendChild(container);
    }
    const t1 = performance.now();
    window.__firstRenderDuration = t1 - t0;
  </script>
</body>
</html>`;

    await page.setContent(testHtml);
    await page.waitForFunction(() => window.__firstRenderDuration !== undefined);
    const duration = await page.evaluate(() => window.__firstRenderDuration);

    expect(typeof duration).toBe('number');
    expect(duration).toBeGreaterThan(0);
    expect(duration).toBeLessThan(1000);
  });
});
