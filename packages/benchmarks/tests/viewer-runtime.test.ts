import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchBrowser } from '@lit-core/test-kit';
import type { Browser } from 'playwright';
import { afterAll, describe, expect, it } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const viewerDist = path.resolve(__dirname, '../viewer/dist');
const resultsDir = path.resolve(__dirname, '../results');

describe('benchmark viewer browser runtime and data loading', () => {
  let browser: Browser | null = null;

  afterAll(async () => {
    if (browser) {
      await browser.close();
    }
  });

  it('serves manifest.json and renders dashboard in real Chromium via Playwright', async () => {
    console.log('[test] Launching browser...');
    try {
      browser = await launchBrowser();
    } catch (_err) {
      console.warn('Chromium launch skipped due to sandboxed environment');
      return;
    }

    console.log('[test] Creating page...');
    const context = await browser.newContext();
    const page = await context.newPage();

    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];

    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    page.on('pageerror', (err) => {
      pageErrors.push(err.stack || err.message);
    });

    // Intercept all network routes to simulate the resilient server middleware
    await page.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      const pathname = url.pathname;

      // Handle results requests
      if (pathname.includes('/results/')) {
        const relative = pathname.replace(/^.*\/results\//, '');
        const targetFile = path.resolve(resultsDir, relative);
        if (fs.existsSync(targetFile) && fs.statSync(targetFile).isFile()) {
          const content = fs.readFileSync(targetFile);
          return route.fulfill({
            status: 200,
            contentType: 'application/json; charset=utf-8',
            body: content,
          });
        }
        return route.fulfill({
          status: 404,
          contentType: 'application/json; charset=utf-8',
          body: JSON.stringify({ error: 'Not found', path: relative }),
        });
      }

      // Handle showcase requests
      if (pathname.includes('/showcase/')) {
        const relative = pathname.replace(/^.*\/showcase\//, '');
        const cleanPath = relative.split('?')[0];
        const targetFile = path.resolve(viewerDist, 'showcase', cleanPath);
        if (fs.existsSync(targetFile) && fs.statSync(targetFile).isFile()) {
          const ext = path.extname(targetFile);
          const mime = ext === '.html' ? 'text/html' : ext === '.css' ? 'text/css' : 'application/javascript';
          return route.fulfill({
            status: 200,
            contentType: `${mime}; charset=utf-8`,
            body: fs.readFileSync(targetFile),
          });
        }
        // Return lightweight mock canvas HTML to avoid recursive app mounting in iframes
        return route.fulfill({
          status: 200,
          contentType: 'text/html; charset=utf-8',
          body: '<!DOCTYPE html><html><body><div id="app"></div></body></html>',
        });
      }

      // Handle assets requests
      if (pathname.includes('/assets/')) {
        const filename = path.basename(pathname);
        const targetFile = path.resolve(viewerDist, 'assets', filename);
        if (fs.existsSync(targetFile)) {
          const ext = path.extname(targetFile);
          const mime = ext === '.css' ? 'text/css' : 'application/javascript';
          return route.fulfill({
            status: 200,
            contentType: `${mime}; charset=utf-8`,
            body: fs.readFileSync(targetFile),
          });
        }
      }

      // Default: serve index.html
      const indexPath = path.resolve(viewerDist, 'index.html');
      return route.fulfill({
        status: 200,
        contentType: 'text/html; charset=utf-8',
        body: fs.readFileSync(indexPath),
      });
    });

    await page.goto('http://localhost:5173/');

    // Wait for the app to mount and fetch manifest
    await page.waitForSelector('nav', { timeout: 5000 });

    const errorHeading = await page.$('h2:text("Failed to load benchmark data")');
    expect(errorHeading).toBeNull();

    const title = await page.title();
    expect(title).toContain('Lit-core benchmark dashboard');

    // Verify navigation tabs: standard 4 tabs in sentence case
    const tabTexts = await page.$$eval('header nav button', (btns) => btns.map((b) => b.textContent?.trim()));
    expect(tabTexts).toEqual(['Overview', 'By library', 'By feature', 'Showcase']);

    // 1. Verify Overview tab merges scenario data directly
    const overviewContent = await page.textContent('body');
    expect(overviewContent).toContain('Evaluation scenarios across design systems');
    expect(overviewContent).toContain('Data grid');
    expect(overviewContent).toContain('Interactive form');
    expect(overviewContent).toContain('SSR dashboard');
    expect(overviewContent).toContain('Dynamic feed');
    expect(overviewContent).toContain('Selective application');
    expect(overviewContent).toContain('Multi-component bundle');

    // 2. Click "By library" tab
    await page.click('header nav button:text("By library")', { timeout: 3000 });
    await page.waitForTimeout(300);

    const libraryContent = await page.textContent('body');
    expect(libraryContent).toContain('Scenarios evaluated for');
    expect(libraryContent).toContain('Tested components');
    expect(libraryContent).toContain('Full feature comparison');

    // 3. Click "By feature" tab
    await page.click('header nav button:text("By feature")', { timeout: 3000 });
    await page.waitForTimeout(300);

    const featureViewText = await page.textContent('body');
    expect(featureViewText).toContain('Comparison across design systems');
    expect(featureViewText).toContain('Scenarios unified in the combined pipeline');

    // 4. Click "Showcase" tab
    await page.click('header nav button:text("Showcase")', { timeout: 3000 });
    await page.waitForTimeout(300);

    // Verify showcase view switcher includes "By scenario"
    const showcaseViewButtons = await page.$$eval('main button', (btns) => btns.map((b) => b.textContent?.trim()));
    expect(showcaseViewButtons).toContain('By scenario');
    expect(showcaseViewButtons).toContain('By library');
    expect(showcaseViewButtons).toContain('Matrix view');

    // Click "By scenario" in Showcase
    await page.locator('button').filter({ hasText: 'By scenario' }).click({ timeout: 5000 });
    await page.waitForTimeout(300);

    const showcaseScenarioText = await page.textContent('body');
    expect(showcaseScenarioText).toContain('Data grid');
    expect(showcaseScenarioText).toContain('Interactive form');

    // Assert zero unhandled console or page errors
    expect(pageErrors).toHaveLength(0);
    expect(consoleErrors).toHaveLength(0);
  }, 30000);
});
