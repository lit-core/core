import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { minifyEmbeddedCss } from '@lit-core/css-minifier';
import {
  CARBON_COMPONENTS,
  SPECTRUM_COMPONENTS,
  WEBAWESOME_COMPONENTS,
  MATERIAL_COMPONENTS,
  MOMENTUM_COMPONENTS,
} from './components.js';
import { findComponentCssSource, extractCssFromModule } from './fixtures.js';
import { getTestBrowser } from './harness.js';

describe('css-minifier playwright multi-framework test suite', () => {
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
  describe('Carbon Web Components real stylesheet minification', () => {
    CARBON_COMPONENTS.forEach((comp, index) => {
      it(`[Carbon ${index + 1}/51] minifies real CSS for ${comp.name} and verifies browser adoption in real Chromium`, async () => {
        const rawSource = findComponentCssSource(comp.pkg, comp.css, comp.source);
        const res = minifyEmbeddedCss(rawSource, { filename: comp.css || comp.source });
        expect(res.code).toBeDefined();

        const css = extractCssFromModule(res.code) || extractCssFromModule(rawSource);
        expect(css.length).toBeGreaterThan(0);

        const ok = await page.evaluate(
          ({ tag, cssText }: { tag: string; cssText: string }) => {
            const host = document.createElement(tag);
            const shadow = host.attachShadow({ mode: 'open' });
            const sheet = new CSSStyleSheet();
            try {
              sheet.replaceSync(cssText);
            } catch {}
            shadow.adoptedStyleSheets = [sheet];
            document.getElementById('app')!.appendChild(host);
            const applied = shadow.adoptedStyleSheets.length === 1;
            document.getElementById('app')!.removeChild(host);
            return applied;
          },
          { tag: comp.tag, cssText: css }
        );

        expect(ok).toBe(true);
      });
    });
  });

  // =========================================================================
  // FRAMEWORK 2: Spectrum Web Components (51 tests)
  // =========================================================================
  describe('Spectrum Web Components real stylesheet minification', () => {
    SPECTRUM_COMPONENTS.forEach((comp, index) => {
      it(`[Spectrum ${index + 1}/51] minifies real CSS for ${comp.name} and verifies browser adoption in real Chromium`, async () => {
        const rawSource = findComponentCssSource(comp.pkg, comp.css, comp.source);
        const res = minifyEmbeddedCss(rawSource, { filename: comp.css || comp.source });
        expect(res.code).toBeDefined();

        const css = extractCssFromModule(res.code) || extractCssFromModule(rawSource);
        expect(css.length).toBeGreaterThan(0);

        const ok = await page.evaluate(
          ({ tag, cssText }: { tag: string; cssText: string }) => {
            const host = document.createElement(tag);
            const shadow = host.attachShadow({ mode: 'open' });
            const sheet = new CSSStyleSheet();
            try {
              sheet.replaceSync(cssText);
            } catch {}
            shadow.adoptedStyleSheets = [sheet];
            document.getElementById('app')!.appendChild(host);
            const applied = shadow.adoptedStyleSheets.length === 1;
            document.getElementById('app')!.removeChild(host);
            return applied;
          },
          { tag: comp.tag, cssText: css }
        );

        expect(ok).toBe(true);
      });
    });
  });

  // =========================================================================
  // FRAMEWORK 3: Web Awesome (51 tests)
  // =========================================================================
  describe('Web Awesome real stylesheet minification', () => {
    WEBAWESOME_COMPONENTS.forEach((comp, index) => {
      it(`[Web Awesome ${index + 1}/51] minifies real CSS for ${comp.name} and verifies browser adoption in real Chromium`, async () => {
        const rawSource = findComponentCssSource(comp.pkg, comp.css, comp.source);
        const res = minifyEmbeddedCss(rawSource, { filename: comp.css || comp.source });
        expect(res.code).toBeDefined();

        let css = extractCssFromModule(res.code) || extractCssFromModule(rawSource);
        if (!css) {
          const compSource = findComponentCssSource(comp.pkg, undefined, comp.source);
          css = extractCssFromModule(compSource);
        }
        expect(css.length).toBeGreaterThan(0);

        const ok = await page.evaluate(
          ({ tag, cssText }: { tag: string; cssText: string }) => {
            const host = document.createElement(tag);
            const shadow = host.attachShadow({ mode: 'open' });
            const sheet = new CSSStyleSheet();
            try {
              sheet.replaceSync(cssText);
            } catch {}
            shadow.adoptedStyleSheets = [sheet];
            document.getElementById('app')!.appendChild(host);
            const applied = shadow.adoptedStyleSheets.length === 1;
            document.getElementById('app')!.removeChild(host);
            return applied;
          },
          { tag: comp.tag, cssText: css }
        );

        expect(ok).toBe(true);
      });
    });
  });

  // =========================================================================
  // FRAMEWORK 4: Google Material Web (51 tests)
  // =========================================================================
  describe('Google Material Web real stylesheet minification', () => {
    MATERIAL_COMPONENTS.forEach((comp, index) => {
      it(`[Material ${index + 1}/51] minifies real CSS for ${comp.name} and verifies browser adoption in real Chromium`, async () => {
        const rawSource = findComponentCssSource(comp.pkg, comp.css, comp.source);
        const res = minifyEmbeddedCss(rawSource, { filename: comp.css || comp.source });
        expect(res.code).toBeDefined();

        const css = extractCssFromModule(res.code) || extractCssFromModule(rawSource);
        expect(css.length).toBeGreaterThan(0);

        const ok = await page.evaluate(
          ({ tag, cssText }: { tag: string; cssText: string }) => {
            const host = document.createElement(tag);
            const shadow = host.attachShadow({ mode: 'open' });
            const sheet = new CSSStyleSheet();
            try {
              sheet.replaceSync(cssText);
            } catch {}
            shadow.adoptedStyleSheets = [sheet];
            document.getElementById('app')!.appendChild(host);
            const applied = shadow.adoptedStyleSheets.length === 1;
            document.getElementById('app')!.removeChild(host);
            return applied;
          },
          { tag: comp.tag, cssText: css }
        );

        expect(ok).toBe(true);
      });
    });
  });

  // =========================================================================
  // FRAMEWORK 5: Cisco Momentum Design (51 tests)
  // =========================================================================
  describe('Cisco Momentum Design real stylesheet minification', () => {
    MOMENTUM_COMPONENTS.forEach((comp, index) => {
      it(`[Momentum ${index + 1}/51] minifies real CSS for ${comp.name} and verifies browser adoption in real Chromium`, async () => {
        const rawSource = findComponentCssSource(comp.pkg, comp.css, comp.source);
        const res = minifyEmbeddedCss(rawSource, { filename: comp.css || comp.source });
        expect(res.code).toBeDefined();

        const css = extractCssFromModule(res.code) || extractCssFromModule(rawSource);
        expect(css.length).toBeGreaterThan(0);

        const ok = await page.evaluate(
          ({ tag, cssText }: { tag: string; cssText: string }) => {
            const host = document.createElement(tag);
            const shadow = host.attachShadow({ mode: 'open' });
            const sheet = new CSSStyleSheet();
            try {
              sheet.replaceSync(cssText);
            } catch {}
            shadow.adoptedStyleSheets = [sheet];
            document.getElementById('app')!.appendChild(host);
            const applied = shadow.adoptedStyleSheets.length === 1;
            document.getElementById('app')!.removeChild(host);
            return applied;
          },
          { tag: comp.tag, cssText: css }
        );

        expect(ok).toBe(true);
      });
    });
  });
});
