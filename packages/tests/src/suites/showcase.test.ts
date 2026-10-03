import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ALL_CANONICAL_COMPONENTS, CONCEPTS, LIBRARIES } from '@lit-core/showcase/canonical-registry';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeTestBrowser, getTestBrowser } from '../harness.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distBaseDir = path.resolve(__dirname, '../../../showcase/dist');

describe('multi-framework canonical component test showcase', () => {
  // =========================================================================
  // SUITE 1: Canonical component matrix & tag registry invariants
  // =========================================================================
  describe('canonical component matrix specifications', () => {
    it('defines exactly 100 canonical component items across 5 design systems', () => {
      expect(ALL_CANONICAL_COMPONENTS.length).toBe(100);
      expect(LIBRARIES.length).toBe(5);
      expect(CONCEPTS.length).toBe(20);
    });

    it('guarantees complete concept parity across every design system', () => {
      for (const lib of LIBRARIES) {
        const libComponents = ALL_CANONICAL_COMPONENTS.filter((c) => c.library === lib.id);
        expect(libComponents.length).toBe(20);

        for (const concept of CONCEPTS) {
          const matching = libComponents.find((c) => c.concept === concept.id);
          expect(matching).toBeDefined();
          expect(matching?.tag.length).toBeGreaterThan(0);
        }
      }
    });

    it('enforces official vendor namespace prefixes per design system', () => {
      const prefixes: Record<string, string> = {
        carbon: 'cds-',
        spectrum: 'sp-',
        webawesome: 'wa-',
        material: 'md-',
        momentum: 'mdc-',
      };

      for (const comp of ALL_CANONICAL_COMPONENTS) {
        const expectedPrefix = prefixes[comp.library];
        expect(comp.tag.startsWith(expectedPrefix)).toBe(true);
      }
    });

    it('enforces zero custom element registry tag collisions across all 100 components', () => {
      const tags = ALL_CANONICAL_COMPONENTS.map((c) => c.tag);
      const uniqueTags = new Set(tags);
      expect(uniqueTags.size).toBe(tags.length);
    });

    it('generates valid mounting HTML with correct ID and custom element tag', () => {
      for (const comp of ALL_CANONICAL_COMPONENTS) {
        const testId = `test-${comp.library}-${comp.concept}`;
        const html = comp.renderHtml(testId);
        expect(html).toContain(`id="${testId}"`);
        expect(html).toContain(`<${comp.tag}`);
      }
    });
  });

  // =========================================================================
  // SUITE 2: Multi-configuration build artifact inspection
  // =========================================================================
  describe('multi-configuration build outputs and portal hub', () => {
    const requiredFeatures = [
      'baseline',
      'css-fuse',
      'props-lower',
      'html-aot',
      'event-hoist',
      'dom-paths',
      'dirty-mask',
      'memoize',
      'elem-proxy',
      'resumable',
      'native',
      'css-minifier',
      'html-minifier',
      'all',
    ];

    it('verifies all 14 showcase configuration directories exist in dist', () => {
      expect(fs.existsSync(distBaseDir)).toBe(true);

      for (const feat of requiredFeatures) {
        const featDir = path.join(distBaseDir, feat);
        expect(fs.existsSync(featDir)).toBe(true);

        const htmlFile = path.join(featDir, 'index.html');
        expect(fs.existsSync(htmlFile)).toBe(true);

        const htmlContent = fs.readFileSync(htmlFile, 'utf-8');
        expect(htmlContent).toContain('<meta name="viewport"');
        expect(htmlContent).toContain('id="app"');

        // Check bundled assets
        const assetsDir = path.join(featDir, 'assets');
        expect(fs.existsSync(assetsDir)).toBe(true);
        const assets = fs.readdirSync(assetsDir);
        const hasJs = assets.some((f) => f.endsWith('.js'));
        const hasCss = assets.some((f) => f.endsWith('.css'));
        expect(hasJs).toBe(true);
        expect(hasCss).toBe(true);
      }
    });

    it('verifies Scandinavian design aesthetics in GitHub Pages portal hub', () => {
      const hubPath = path.join(distBaseDir, 'index.html');
      expect(fs.existsSync(hubPath)).toBe(true);

      const hubContent = fs.readFileSync(hubPath, 'utf-8');

      // Inter font imported
      expect(hubContent).toContain('family=Inter');

      // Sentence case table headers
      expect(hubContent).toContain('<th>Feature configuration</th>');
      expect(hubContent).toContain('<th>Description</th>');
      expect(hubContent).toContain('<th class="numeric">Raw bundle</th>');
      expect(hubContent).toContain('<th class="numeric">Gzip bundle</th>');
      expect(hubContent).toContain('<th class="numeric">Build time</th>');
      expect(hubContent).toContain('<th>Launch</th>');

      // Lists all 14 features
      for (const feat of requiredFeatures) {
        expect(hubContent).toContain(`href="./${feat}/"`);
      }

      // No monospace font declarations
      expect(hubContent).not.toMatch(/font-family:[^;]*monospace/i);
      expect(hubContent).not.toMatch(/font-family:[^;]*Courier/i);
      expect(hubContent).not.toMatch(/font-family:[^;]*Consolas/i);
    });
  });

  // =========================================================================
  // SUITE 3: Playwright Chromium DOM & interaction test runner
  // =========================================================================
  describe('Chromium runtime test execution and component audit', () => {
    let browser: any = null;

    beforeAll(async () => {
      try {
        browser = await getTestBrowser();
      } catch {
        browser = null;
      }
    });

    afterAll(async () => {
      await closeTestBrowser();
    });

    it('loads baseline showcase and verifies window.__TEST_RESULTS__', async () => {
      if (!browser) {
        console.warn('Chromium browser launch not supported in current environment; skipping browser navigation.');
        return;
      }

      const page = await browser.newPage();
      try {
        await page.route('https://showcase.local/**', (route: any) => {
          const url = new URL(route.request().url());
          let reqPath = url.pathname;
          if (reqPath.endsWith('/')) reqPath += 'index.html';
          const filePath = path.join(distBaseDir, reqPath);

          if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
            const ext = path.extname(filePath);
            const mimeTypes: Record<string, string> = {
              '.html': 'text/html; charset=utf-8',
              '.js': 'application/javascript; charset=utf-8',
              '.css': 'text/css; charset=utf-8',
              '.json': 'application/json',
              '.svg': 'image/svg+xml',
            };
            const body = fs.readFileSync(filePath);
            route.fulfill({
              status: 200,
              contentType: mimeTypes[ext] || 'application/octet-stream',
              body,
            });
          } else {
            route.fulfill({ status: 404, body: 'Not found' });
          }
        });

        await page.goto('https://showcase.local/baseline/index.html', {
          waitUntil: 'domcontentloaded',
          timeout: 15000,
        });

        // Wait for app mounting and test results availability
        await page.waitForFunction(() => Boolean((window as any).__TEST_RESULTS__), {
          timeout: 10000,
        });

        const testResults = await page.evaluate(() => (window as any).__TEST_RESULTS__);
        expect(testResults).toBeDefined();
        expect(testResults.totalComponents).toBe(100);
        expect(testResults.definedComponents).toBeGreaterThanOrEqual(95);
        expect(testResults.mountedComponents).toBeGreaterThanOrEqual(95);
        expect(testResults.shadowRootsAttached).toBeGreaterThanOrEqual(80);

        // Run interactive tests in Chromium
        await page.evaluate(async () => {
          if ((window as any).__TEST_RESULTS__?.runInteractiveTests) {
            await (window as any).__TEST_RESULTS__.runInteractiveTests();
          }
        });

        const updatedResults = await page.evaluate(() => (window as any).__TEST_RESULTS__);
        expect(updatedResults.interactivePassed).toBeGreaterThanOrEqual(80);

        // Test view switching: By library
        await page.click('[data-view="library"]');
        const libraryPillCount = await page.locator('[data-lib]').count();
        expect(libraryPillCount).toBeGreaterThanOrEqual(5);

        // Test view switching: By concept
        await page.click('[data-view="concept"]');
        const conceptPillCount = await page.locator('[data-concept]').count();
        expect(conceptPillCount).toBeGreaterThanOrEqual(20);

        // Test search input
        await page.fill('#search-input', 'button');
        const filteredCount = await page.locator('.component-card').count();
        expect(filteredCount).toBeGreaterThanOrEqual(5);
      } finally {
        await page.close();
      }
    });
  });
});
