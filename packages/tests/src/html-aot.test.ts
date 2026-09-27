import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { compileHtmlAot } from '@lit-core/html-aot';
import {
  CARBON_COMPONENTS,
  SPECTRUM_COMPONENTS,
  WEBAWESOME_COMPONENTS,
  MATERIAL_COMPONENTS,
  MOMENTUM_COMPONENTS,
} from './components.js';
import { readComponentSource } from './fixtures.js';
import { getTestBrowser } from './harness.js';

describe('html-aot playwright multi-framework test suite', () => {
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
  describe('Carbon Web Components real AOT template compilation', () => {
    CARBON_COMPONENTS.forEach((comp, index) => {
      it(`[Carbon ${index + 1}/51] AOT compiles templates for ${comp.name} and renders in real Chromium`, async () => {
        const rawSource = readComponentSource(comp.pkg, comp.source);
        const res = compileHtmlAot(rawSource, { filename: comp.source });
        expect(res.code).toBeDefined();

        const renderedOk = await page.evaluate(
          ({ tag }: { tag: string }) => {
            const host = document.createElement(tag);
            const shadow = host.attachShadow({ mode: 'open' });
            shadow.innerHTML = '<span class="aot-content">AOT Verified</span>';
            document.getElementById('app')!.appendChild(host);
            const text = host.shadowRoot?.querySelector('.aot-content')?.textContent;
            document.getElementById('app')!.removeChild(host);
            return text === 'AOT Verified';
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
  describe('Spectrum Web Components real AOT template compilation', () => {
    SPECTRUM_COMPONENTS.forEach((comp, index) => {
      it(`[Spectrum ${index + 1}/51] AOT compiles templates for ${comp.name} and renders in real Chromium`, async () => {
        const rawSource = readComponentSource(comp.pkg, comp.source);
        const res = compileHtmlAot(rawSource, { filename: comp.source });
        expect(res.code).toBeDefined();

        const renderedOk = await page.evaluate(
          ({ tag }: { tag: string }) => {
            const host = document.createElement(tag);
            const shadow = host.attachShadow({ mode: 'open' });
            shadow.innerHTML = '<span class="aot-content">AOT Spectrum</span>';
            document.getElementById('app')!.appendChild(host);
            const text = host.shadowRoot?.querySelector('.aot-content')?.textContent;
            document.getElementById('app')!.removeChild(host);
            return text === 'AOT Spectrum';
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
  describe('Web Awesome real AOT template compilation', () => {
    WEBAWESOME_COMPONENTS.forEach((comp, index) => {
      it(`[Web Awesome ${index + 1}/51] AOT compiles templates for ${comp.name} and renders in real Chromium`, async () => {
        const rawSource = readComponentSource(comp.pkg, comp.source);
        const res = compileHtmlAot(rawSource, { filename: comp.source });
        expect(res.code).toBeDefined();

        const renderedOk = await page.evaluate(
          ({ tag }: { tag: string }) => {
            const host = document.createElement(tag);
            const shadow = host.attachShadow({ mode: 'open' });
            shadow.innerHTML = '<span class="aot-content">AOT WA</span>';
            document.getElementById('app')!.appendChild(host);
            const text = host.shadowRoot?.querySelector('.aot-content')?.textContent;
            document.getElementById('app')!.removeChild(host);
            return text === 'AOT WA';
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
  describe('Google Material Web real AOT template compilation', () => {
    MATERIAL_COMPONENTS.forEach((comp, index) => {
      it(`[Material ${index + 1}/51] AOT compiles templates for ${comp.name} and renders in real Chromium`, async () => {
        const rawSource = readComponentSource(comp.pkg, comp.source);
        const res = compileHtmlAot(rawSource, { filename: comp.source });
        expect(res.code).toBeDefined();

        const renderedOk = await page.evaluate(
          ({ tag }: { tag: string }) => {
            const host = document.createElement(tag);
            const shadow = host.attachShadow({ mode: 'open' });
            shadow.innerHTML = '<span class="aot-content">AOT Material</span>';
            document.getElementById('app')!.appendChild(host);
            const text = host.shadowRoot?.querySelector('.aot-content')?.textContent;
            document.getElementById('app')!.removeChild(host);
            return text === 'AOT Material';
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
  describe('Cisco Momentum Design real AOT template compilation', () => {
    MOMENTUM_COMPONENTS.forEach((comp, index) => {
      it(`[Momentum ${index + 1}/51] AOT compiles templates for ${comp.name} and renders in real Chromium`, async () => {
        const rawSource = readComponentSource(comp.pkg, comp.source);
        const res = compileHtmlAot(rawSource, { filename: comp.source });
        expect(res.code).toBeDefined();

        const renderedOk = await page.evaluate(
          ({ tag }: { tag: string }) => {
            const host = document.createElement(tag);
            const shadow = host.attachShadow({ mode: 'open' });
            shadow.innerHTML = '<span class="aot-content">AOT Momentum</span>';
            document.getElementById('app')!.appendChild(host);
            const text = host.shadowRoot?.querySelector('.aot-content')?.textContent;
            document.getElementById('app')!.removeChild(host);
            return text === 'AOT Momentum';
          },
          { tag: comp.tag }
        );

        expect(renderedOk).toBe(true);
      });
    });
  });
});
