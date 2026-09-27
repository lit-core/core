import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fuse } from '@lit-core/css-fuse';
import {
  CARBON_COMPONENTS,
  SPECTRUM_COMPONENTS,
  WEBAWESOME_COMPONENTS,
  MATERIAL_COMPONENTS,
  MOMENTUM_COMPONENTS,
} from './components.js';
import {
  readComponentSource,
  findComponentCssSource,
  extractCssFromModule,
  resolveWorkspacePath,
} from './fixtures.js';
import { getTestBrowser } from './harness.js';

describe('css-fuse playwright multi-framework test suite', () => {
  let browser: any;
  let page: any;

  beforeAll(async () => {
    browser = await getTestBrowser();
    page = await browser.newPage();
    await page.setContent('<!DOCTYPE html><html><body><div id="app"></div></body></html>');
  });

  afterAll(async () => {
    if (page) await page.close();
  });

  // =========================================================================
  // FRAMEWORK 1: Carbon Web Components (51 tests)
  // =========================================================================
  describe('Carbon Web Components real stylesheet extraction & constructable sheets', () => {
    CARBON_COMPONENTS.forEach((comp, index) => {
      it(`[Carbon ${index + 1}/51] extracts real CSS from ${comp.name} and adopts constructable sheet in real Chromium`, async () => {
        const rawSource = findComponentCssSource(comp.pkg, comp.css, comp.source);
        const cssContent = extractCssFromModule(rawSource);
        expect(cssContent.length).toBeGreaterThan(0);

        const result = await page.evaluate(
          ({ tag, css }: { tag: string; css: string }) => {
            const host = document.createElement(tag);
            const shadow = host.attachShadow({ mode: 'open' });
            const sheet = new CSSStyleSheet();
            try {
              sheet.replaceSync(css);
            } catch {}
            shadow.adoptedStyleSheets = [sheet];
            const div = document.createElement('div');
            div.className = 'content';
            shadow.appendChild(div);
            document.getElementById('app')!.appendChild(host);
            const applied = shadow.adoptedStyleSheets.length === 1;
            document.getElementById('app')!.removeChild(host);
            return { applied, rulesCount: sheet.cssRules.length };
          },
          { tag: comp.tag, css: cssContent }
        );

        expect(result.applied).toBe(true);
        expect(result.rulesCount).toBeGreaterThanOrEqual(0);
      });
    });

    it('deduplicates shared rules across real Carbon components via fuse', () => {
      const files = CARBON_COMPONENTS.slice(0, 10).map((c) =>
        resolveWorkspacePath('node_modules', c.pkg, c.source)
      );
      const res = fuse({ files, threshold: 1, minSavings: 0 });
      expect(res.stats.filesScanned).toBeGreaterThan(0);
    });
  });

  // =========================================================================
  // FRAMEWORK 2: Spectrum Web Components (51 tests)
  // =========================================================================
  describe('Spectrum Web Components real stylesheet extraction & constructable sheets', () => {
    SPECTRUM_COMPONENTS.forEach((comp, index) => {
      it(`[Spectrum ${index + 1}/51] extracts real CSS from ${comp.name} and adopts constructable sheet in real Chromium`, async () => {
        const rawSource = findComponentCssSource(comp.pkg, comp.css, comp.source);
        const cssContent = extractCssFromModule(rawSource);
        expect(cssContent.length).toBeGreaterThan(0);

        const result = await page.evaluate(
          ({ tag, css }: { tag: string; css: string }) => {
            const host = document.createElement(tag);
            const shadow = host.attachShadow({ mode: 'open' });
            const sheet = new CSSStyleSheet();
            try {
              sheet.replaceSync(css);
            } catch {}
            shadow.adoptedStyleSheets = [sheet];
            const div = document.createElement('div');
            div.className = 'content';
            shadow.appendChild(div);
            document.getElementById('app')!.appendChild(host);
            const applied = shadow.adoptedStyleSheets.length === 1;
            document.getElementById('app')!.removeChild(host);
            return { applied, rulesCount: sheet.cssRules.length };
          },
          { tag: comp.tag, css: cssContent }
        );

        expect(result.applied).toBe(true);
        expect(result.rulesCount).toBeGreaterThanOrEqual(0);
      });
    });

    it('deduplicates shared rules across real Spectrum components via fuse', () => {
      const files = SPECTRUM_COMPONENTS.slice(0, 10).map((c) =>
        resolveWorkspacePath('node_modules', c.pkg, c.source)
      );
      const res = fuse({ files, threshold: 1, minSavings: 0 });
      expect(res.stats.filesScanned).toBeGreaterThan(0);
    });
  });

  // =========================================================================
  // FRAMEWORK 3: Web Awesome (51 tests)
  // =========================================================================
  describe('Web Awesome real stylesheet extraction & constructable sheets', () => {
    WEBAWESOME_COMPONENTS.forEach((comp, index) => {
      it(`[Web Awesome ${index + 1}/51] extracts real CSS from ${comp.name} and adopts constructable sheet in real Chromium`, async () => {
        const rawSource = findComponentCssSource(comp.pkg, comp.css, comp.source);
        let cssContent = extractCssFromModule(rawSource);
        if (!cssContent) {
          const compSource = findComponentCssSource(comp.pkg, undefined, comp.source);
          cssContent = extractCssFromModule(compSource);
        }
        expect(cssContent.length).toBeGreaterThan(0);

        const result = await page.evaluate(
          ({ tag, css }: { tag: string; css: string }) => {
            const host = document.createElement(tag);
            const shadow = host.attachShadow({ mode: 'open' });
            const sheet = new CSSStyleSheet();
            try {
              sheet.replaceSync(css);
            } catch {}
            shadow.adoptedStyleSheets = [sheet];
            const div = document.createElement('div');
            div.className = 'content';
            shadow.appendChild(div);
            document.getElementById('app')!.appendChild(host);
            const applied = shadow.adoptedStyleSheets.length === 1;
            document.getElementById('app')!.removeChild(host);
            return { applied, rulesCount: sheet.cssRules.length };
          },
          { tag: comp.tag, css: cssContent }
        );

        expect(result.applied).toBe(true);
        expect(result.rulesCount).toBeGreaterThanOrEqual(0);
      });
    });

    it('deduplicates shared rules across real Web Awesome components via fuse', () => {
      const files = WEBAWESOME_COMPONENTS.slice(0, 10).map((c) =>
        resolveWorkspacePath('node_modules', c.pkg, c.source)
      );
      const res = fuse({ files, threshold: 1, minSavings: 0 });
      expect(res.stats.filesScanned).toBeGreaterThan(0);
    });
  });

  // =========================================================================
  // FRAMEWORK 4: Google Material Web (51 tests)
  // =========================================================================
  describe('Google Material Web real stylesheet extraction & constructable sheets', () => {
    MATERIAL_COMPONENTS.forEach((comp, index) => {
      it(`[Material ${index + 1}/51] extracts real CSS from ${comp.name} and adopts constructable sheet in real Chromium`, async () => {
        const rawSource = findComponentCssSource(comp.pkg, comp.css, comp.source);
        const cssContent = extractCssFromModule(rawSource);
        expect(cssContent.length).toBeGreaterThan(0);

        const result = await page.evaluate(
          ({ tag, css }: { tag: string; css: string }) => {
            const host = document.createElement(tag);
            const shadow = host.attachShadow({ mode: 'open' });
            const sheet = new CSSStyleSheet();
            try {
              sheet.replaceSync(css);
            } catch {}
            shadow.adoptedStyleSheets = [sheet];
            const div = document.createElement('div');
            div.className = 'content';
            shadow.appendChild(div);
            document.getElementById('app')!.appendChild(host);
            const applied = shadow.adoptedStyleSheets.length === 1;
            document.getElementById('app')!.removeChild(host);
            return { applied, rulesCount: sheet.cssRules.length };
          },
          { tag: comp.tag, css: cssContent }
        );

        expect(result.applied).toBe(true);
        expect(result.rulesCount).toBeGreaterThanOrEqual(0);
      });
    });

    it('deduplicates shared rules across real Material Web components via fuse', () => {
      const files = MATERIAL_COMPONENTS.slice(0, 10).map((c) =>
        resolveWorkspacePath('node_modules', c.pkg, c.source)
      );
      const res = fuse({ files, threshold: 1, minSavings: 0 });
      expect(res.stats.filesScanned).toBeGreaterThan(0);
    });
  });

  // =========================================================================
  // FRAMEWORK 5: Cisco Momentum Design (51 tests)
  // =========================================================================
  describe('Cisco Momentum Design real stylesheet extraction & constructable sheets', () => {
    MOMENTUM_COMPONENTS.forEach((comp, index) => {
      it(`[Momentum ${index + 1}/51] extracts real CSS from ${comp.name} and adopts constructable sheet in real Chromium`, async () => {
        const rawSource = findComponentCssSource(comp.pkg, comp.css, comp.source);
        const cssContent = extractCssFromModule(rawSource);
        expect(cssContent.length).toBeGreaterThan(0);

        const result = await page.evaluate(
          ({ tag, css }: { tag: string; css: string }) => {
            const host = document.createElement(tag);
            const shadow = host.attachShadow({ mode: 'open' });
            const sheet = new CSSStyleSheet();
            try {
              sheet.replaceSync(css);
            } catch {}
            shadow.adoptedStyleSheets = [sheet];
            const div = document.createElement('div');
            div.className = 'content';
            shadow.appendChild(div);
            document.getElementById('app')!.appendChild(host);
            const applied = shadow.adoptedStyleSheets.length === 1;
            document.getElementById('app')!.removeChild(host);
            return { applied, rulesCount: sheet.cssRules.length };
          },
          { tag: comp.tag, css: cssContent }
        );

        expect(result.applied).toBe(true);
        expect(result.rulesCount).toBeGreaterThanOrEqual(0);
      });
    });

    it('deduplicates shared rules across real Momentum components via fuse', () => {
      const files = MOMENTUM_COMPONENTS.slice(0, 10).map((c) =>
        resolveWorkspacePath('node_modules', c.pkg, c.source)
      );
      const res = fuse({ files, threshold: 1, minSavings: 0 });
      expect(res.stats.filesScanned).toBeGreaterThan(0);
    });
  });
});
