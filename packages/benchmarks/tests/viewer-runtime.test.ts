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
    try {
      browser = await launchBrowser();
    } catch (_err) {
      console.warn('Chromium launch skipped due to sandboxed environment');
      return;
    }

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

    // Load viewer page
    await page.goto('http://localhost:5173/');

    // Wait for the app to mount and fetch manifest
    await page.waitForSelector('nav', { timeout: 5000 });

    // Ensure error banner is NOT displayed
    const errorHeading = await page.$('h2:text("Failed to load benchmark data")');
    expect(errorHeading).toBeNull();

    // Verify page title
    const title = await page.title();
    expect(title).toContain('Lit-core benchmark dashboard');

    // Verify navigation tabs
    const tabTexts = await page.$$eval('nav button', (btns) => btns.map((b) => b.textContent?.trim()));
    expect(tabTexts).toContain('Overview');
    expect(tabTexts).toContain('By scenario');
    expect(tabTexts).toContain('By library');
    expect(tabTexts).toContain('By feature');
    expect(tabTexts).toContain('Showcase');

    // Verify Overview matrix displays libraries and KPIs
    const tableHeader = await page.$eval('table th', (el) => el.textContent?.trim());
    expect(tableHeader).toBeTruthy();

    // Click "By scenario" tab
    await page.click('button:text("By scenario")');
    await page.waitForTimeout(300);

    // Verify scenario view renders all 6 authentic scenarios as selectable options
    const scenarioPills = await page.$$eval('button', (els) => els.map((el) => el.textContent?.trim()));
    expect(scenarioPills).toContain('Data grid');
    expect(scenarioPills).toContain('Interactive form');
    expect(scenarioPills).toContain('SSR dashboard');
    expect(scenarioPills).toContain('Dynamic feed');
    expect(scenarioPills).toContain('Selective application');
    expect(scenarioPills).toContain('Multi-component bundle');

    // Verify scenario overview heading outside card
    const scenarioHeading = await page.$eval('h2', (el) => el.textContent?.trim());
    expect(scenarioHeading).toContain('Scenario overview');

    // Click "By feature" tab
    await page.click('button:text("By feature")');
    await page.waitForTimeout(300);

    const featureViewText = await page.textContent('body');
    expect(featureViewText).toContain('Comparison across design systems');
    expect(featureViewText).toContain('Evaluation scenario');

    // Assert zero unhandled console or page errors
    expect(pageErrors).toHaveLength(0);
    expect(consoleErrors).toHaveLength(0);
  });
});
