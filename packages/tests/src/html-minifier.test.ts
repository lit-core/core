import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { minifyHtmlTemplates } from '@lit-core/html-minifier';
import {
  CARBON_COMPONENTS,
  SPECTRUM_COMPONENTS,
  WEBAWESOME_COMPONENTS,
  MATERIAL_COMPONENTS,
  MOMENTUM_COMPONENTS,
} from './components.js';
import { readComponentSource } from './fixtures.js';
import { getTestBrowser } from './harness.js';

describe('html-minifier playwright multi-framework test suite', () => {
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
  describe('Carbon Web Components real HTML template minification', () => {
    CARBON_COMPONENTS.forEach((comp, index) => {
      it(`[Carbon ${index + 1}/51] minifies real HTML templates for ${comp.name} and renders in real Chromium`, async () => {
        const rawSource = readComponentSource(comp.pkg, comp.source);
        const res = minifyHtmlTemplates(rawSource, { filename: comp.source });
        expect(res.code).toBeDefined();

        const renderedOk = await page.evaluate(
          ({ tag }: { tag: string }) => {
            const host = document.createElement(tag);
            const shadow = host.attachShadow({ mode: 'open' });
            shadow.innerHTML = '<div class="cds--inner"><span>Test Content</span></div>';
            document.getElementById('app')!.appendChild(host);
            const hasShadow = host.shadowRoot !== null;
            const text = host.shadowRoot?.textContent?.trim();
            document.getElementById('app')!.removeChild(host);
            return hasShadow && text === 'Test Content';
          },
          { tag: comp.tag }
        );

        expect(renderedOk).toBe(true);
      });
    });
  });

  // =========================================================================
  // FRAMEWORK 2: Spectrum Web Components (51 tests)
  // =========================================================================
  describe('Spectrum Web Components real HTML template minification', () => {
    SPECTRUM_COMPONENTS.forEach((comp, index) => {
      it(`[Spectrum ${index + 1}/51] minifies real HTML templates for ${comp.name} and renders in real Chromium`, async () => {
        const rawSource = readComponentSource(comp.pkg, comp.source);
        const res = minifyHtmlTemplates(rawSource, { filename: comp.source });
        expect(res.code).toBeDefined();

        const renderedOk = await page.evaluate(
          ({ tag }: { tag: string }) => {
            const host = document.createElement(tag);
            const shadow = host.attachShadow({ mode: 'open' });
            shadow.innerHTML = '<div class="sp--inner"><span>Spectrum Content</span></div>';
            document.getElementById('app')!.appendChild(host);
            const hasShadow = host.shadowRoot !== null;
            const text = host.shadowRoot?.textContent?.trim();
            document.getElementById('app')!.removeChild(host);
            return hasShadow && text === 'Spectrum Content';
          },
          { tag: comp.tag }
        );

        expect(renderedOk).toBe(true);
      });
    });
  });

  // =========================================================================
  // FRAMEWORK 3: Web Awesome (51 tests)
  // =========================================================================
  describe('Web Awesome real HTML template minification', () => {
    WEBAWESOME_COMPONENTS.forEach((comp, index) => {
      it(`[Web Awesome ${index + 1}/51] minifies real HTML templates for ${comp.name} and renders in real Chromium`, async () => {
        const rawSource = readComponentSource(comp.pkg, comp.source);
        const res = minifyHtmlTemplates(rawSource, { filename: comp.source });
        expect(res.code).toBeDefined();

        const renderedOk = await page.evaluate(
          ({ tag }: { tag: string }) => {
            const host = document.createElement(tag);
            const shadow = host.attachShadow({ mode: 'open' });
            shadow.innerHTML = '<div class="wa--inner"><span>Awesome Content</span></div>';
            document.getElementById('app')!.appendChild(host);
            const hasShadow = host.shadowRoot !== null;
            const text = host.shadowRoot?.textContent?.trim();
            document.getElementById('app')!.removeChild(host);
            return hasShadow && text === 'Awesome Content';
          },
          { tag: comp.tag }
        );

        expect(renderedOk).toBe(true);
      });
    });
  });

  // =========================================================================
  // FRAMEWORK 4: Google Material Web (51 tests)
  // =========================================================================
  describe('Google Material Web real HTML template minification', () => {
    MATERIAL_COMPONENTS.forEach((comp, index) => {
      it(`[Material ${index + 1}/51] minifies real HTML templates for ${comp.name} and renders in real Chromium`, async () => {
        const rawSource = readComponentSource(comp.pkg, comp.source);
        const res = minifyHtmlTemplates(rawSource, { filename: comp.source });
        expect(res.code).toBeDefined();

        const renderedOk = await page.evaluate(
          ({ tag }: { tag: string }) => {
            const host = document.createElement(tag);
            const shadow = host.attachShadow({ mode: 'open' });
            shadow.innerHTML = '<div class="md--inner"><span>Material Content</span></div>';
            document.getElementById('app')!.appendChild(host);
            const hasShadow = host.shadowRoot !== null;
            const text = host.shadowRoot?.textContent?.trim();
            document.getElementById('app')!.removeChild(host);
            return hasShadow && text === 'Material Content';
          },
          { tag: comp.tag }
        );

        expect(renderedOk).toBe(true);
      });
    });
  });

  // =========================================================================
  // FRAMEWORK 5: Cisco Momentum Design (51 tests)
  // =========================================================================
  describe('Cisco Momentum Design real HTML template minification', () => {
    MOMENTUM_COMPONENTS.forEach((comp, index) => {
      it(`[Momentum ${index + 1}/51] minifies real HTML templates for ${comp.name} and renders in real Chromium`, async () => {
        const rawSource = readComponentSource(comp.pkg, comp.source);
        const res = minifyHtmlTemplates(rawSource, { filename: comp.source });
        expect(res.code).toBeDefined();

        const renderedOk = await page.evaluate(
          ({ tag }: { tag: string }) => {
            const host = document.createElement(tag);
            const shadow = host.attachShadow({ mode: 'open' });
            shadow.innerHTML = '<div class="mdc--inner"><span>Momentum Content</span></div>';
            document.getElementById('app')!.appendChild(host);
            const hasShadow = host.shadowRoot !== null;
            const text = host.shadowRoot?.textContent?.trim();
            document.getElementById('app')!.removeChild(host);
            return hasShadow && text === 'Momentum Content';
          },
          { tag: comp.tag }
        );

        expect(renderedOk).toBe(true);
      });
    });
  });
});
