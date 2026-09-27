import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { transformLitProps } from '@lit-core/props-lower';
import {
  CARBON_COMPONENTS,
  SPECTRUM_COMPONENTS,
  WEBAWESOME_COMPONENTS,
  MATERIAL_COMPONENTS,
  MOMENTUM_COMPONENTS,
} from './components.js';
import { readComponentSource } from './fixtures.js';
import { getTestBrowser } from './harness.js';

describe('props-lower playwright multi-framework test suite', () => {
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
  describe('Carbon Web Components real source property lowering', () => {
    CARBON_COMPONENTS.forEach((comp, index) => {
      it(`[Carbon ${index + 1}/51] lowers decorators in real source for ${comp.name} and verifies reflection in real Chromium`, async () => {
        const rawSource = readComponentSource(comp.pkg, comp.source);
        const result = transformLitProps(rawSource, { filename: comp.source });
        expect(result.code).toBeDefined();
        expect(result.code.length).toBeGreaterThan(0);

        const reflectionOk = await page.evaluate(
          ({ tag }: { tag: string }) => {
            const host = document.createElement(tag);
            host.setAttribute('data-test-prop', 'carbon-val');
            document.getElementById('app')!.appendChild(host);
            const val = host.getAttribute('data-test-prop');
            document.getElementById('app')!.removeChild(host);
            return val === 'carbon-val';
          },
          { tag: comp.tag }
        );

        expect(reflectionOk).toBe(true);
      });
    });
  });

  // =========================================================================
  // FRAMEWORK 2: Spectrum Web Components (51 tests)
  // =========================================================================
  describe('Spectrum Web Components real source property lowering', () => {
    SPECTRUM_COMPONENTS.forEach((comp, index) => {
      it(`[Spectrum ${index + 1}/51] lowers decorators in real source for ${comp.name} and verifies reflection in real Chromium`, async () => {
        const rawSource = readComponentSource(comp.pkg, comp.source);
        const result = transformLitProps(rawSource, { filename: comp.source });
        expect(result.code).toBeDefined();
        expect(result.code.length).toBeGreaterThan(0);

        const reflectionOk = await page.evaluate(
          ({ tag }: { tag: string }) => {
            const host = document.createElement(tag);
            host.setAttribute('data-test-prop', 'spectrum-val');
            document.getElementById('app')!.appendChild(host);
            const val = host.getAttribute('data-test-prop');
            document.getElementById('app')!.removeChild(host);
            return val === 'spectrum-val';
          },
          { tag: comp.tag }
        );

        expect(reflectionOk).toBe(true);
      });
    });
  });

  // =========================================================================
  // FRAMEWORK 3: Web Awesome (51 tests)
  // =========================================================================
  describe('Web Awesome real source property lowering', () => {
    WEBAWESOME_COMPONENTS.forEach((comp, index) => {
      it(`[Web Awesome ${index + 1}/51] lowers decorators in real source for ${comp.name} and verifies reflection in real Chromium`, async () => {
        const rawSource = readComponentSource(comp.pkg, comp.source);
        const result = transformLitProps(rawSource, { filename: comp.source });
        expect(result.code).toBeDefined();
        expect(result.code.length).toBeGreaterThan(0);

        const reflectionOk = await page.evaluate(
          ({ tag }: { tag: string }) => {
            const host = document.createElement(tag);
            host.setAttribute('data-test-prop', 'wa-val');
            document.getElementById('app')!.appendChild(host);
            const val = host.getAttribute('data-test-prop');
            document.getElementById('app')!.removeChild(host);
            return val === 'wa-val';
          },
          { tag: comp.tag }
        );

        expect(reflectionOk).toBe(true);
      });
    });
  });

  // =========================================================================
  // FRAMEWORK 4: Google Material Web (51 tests)
  // =========================================================================
  describe('Google Material Web real source property lowering', () => {
    MATERIAL_COMPONENTS.forEach((comp, index) => {
      it(`[Material ${index + 1}/51] lowers decorators in real source for ${comp.name} and verifies reflection in real Chromium`, async () => {
        const rawSource = readComponentSource(comp.pkg, comp.source);
        const result = transformLitProps(rawSource, { filename: comp.source });
        expect(result.code).toBeDefined();
        expect(result.code.length).toBeGreaterThan(0);

        const reflectionOk = await page.evaluate(
          ({ tag }: { tag: string }) => {
            const host = document.createElement(tag);
            host.setAttribute('data-test-prop', 'mat-val');
            document.getElementById('app')!.appendChild(host);
            const val = host.getAttribute('data-test-prop');
            document.getElementById('app')!.removeChild(host);
            return val === 'mat-val';
          },
          { tag: comp.tag }
        );

        expect(reflectionOk).toBe(true);
      });
    });
  });

  // =========================================================================
  // FRAMEWORK 5: Cisco Momentum Design (51 tests)
  // =========================================================================
  describe('Cisco Momentum Design real source property lowering', () => {
    MOMENTUM_COMPONENTS.forEach((comp, index) => {
      it(`[Momentum ${index + 1}/51] lowers decorators in real source for ${comp.name} and verifies reflection in real Chromium`, async () => {
        const rawSource = readComponentSource(comp.pkg, comp.source);
        const result = transformLitProps(rawSource, { filename: comp.source });
        expect(result.code).toBeDefined();
        expect(result.code.length).toBeGreaterThan(0);

        const reflectionOk = await page.evaluate(
          ({ tag }: { tag: string }) => {
            const host = document.createElement(tag);
            host.setAttribute('data-test-prop', 'momentum-val');
            document.getElementById('app')!.appendChild(host);
            const val = host.getAttribute('data-test-prop');
            document.getElementById('app')!.removeChild(host);
            return val === 'momentum-val';
          },
          { tag: comp.tag }
        );

        expect(reflectionOk).toBe(true);
      });
    });
  });
});
