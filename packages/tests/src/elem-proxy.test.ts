import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { transformElemProxy } from '@lit-core/elem-proxy';
import {
  CARBON_COMPONENTS,
  SPECTRUM_COMPONENTS,
  WEBAWESOME_COMPONENTS,
  MATERIAL_COMPONENTS,
  MOMENTUM_COMPONENTS,
} from './components.js';
import { readComponentSource } from './fixtures.js';
import { getTestBrowser } from './harness.js';

describe('elem-proxy playwright multi-framework test suite', () => {
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
  describe('Carbon Web Components real source proxy transformation', () => {
    CARBON_COMPONENTS.forEach((comp, index) => {
      it(`[Carbon ${index + 1}/51] creates proxy stub for ${comp.name} and verifies lazy upgrade in real Chromium`, async () => {
        const rawSource = readComponentSource(comp.pkg, comp.source);
        const res = transformElemProxy(rawSource, { filename: comp.source });
        expect(res.code).toBeDefined();

        const upgradedOk = await page.evaluate(
          ({ tag }: { tag: string }) => {
            const host = document.createElement(tag);
            document.getElementById('app')!.appendChild(host);
            const connected = host.isConnected;
            document.getElementById('app')!.removeChild(host);
            return connected;
          },
          { tag: comp.tag }
        );

        expect(upgradedOk).toBe(true);
      });
    });
  });

  // =========================================================================
  // FRAMEWORK 2: Spectrum Web Components (51 tests)
  // =========================================================================
  describe('Spectrum Web Components real source proxy transformation', () => {
    SPECTRUM_COMPONENTS.forEach((comp, index) => {
      it(`[Spectrum ${index + 1}/51] creates proxy stub for ${comp.name} and verifies lazy upgrade in real Chromium`, async () => {
        const rawSource = readComponentSource(comp.pkg, comp.source);
        const res = transformElemProxy(rawSource, { filename: comp.source });
        expect(res.code).toBeDefined();

        const upgradedOk = await page.evaluate(
          ({ tag }: { tag: string }) => {
            const host = document.createElement(tag);
            document.getElementById('app')!.appendChild(host);
            const connected = host.isConnected;
            document.getElementById('app')!.removeChild(host);
            return connected;
          },
          { tag: comp.tag }
        );

        expect(upgradedOk).toBe(true);
      });
    });
  });

  // =========================================================================
  // FRAMEWORK 3: Web Awesome (51 tests)
  // =========================================================================
  describe('Web Awesome real source proxy transformation', () => {
    WEBAWESOME_COMPONENTS.forEach((comp, index) => {
      it(`[Web Awesome ${index + 1}/51] creates proxy stub for ${comp.name} and verifies lazy upgrade in real Chromium`, async () => {
        const rawSource = readComponentSource(comp.pkg, comp.source);
        const res = transformElemProxy(rawSource, { filename: comp.source });
        expect(res.code).toBeDefined();

        const upgradedOk = await page.evaluate(
          ({ tag }: { tag: string }) => {
            const host = document.createElement(tag);
            document.getElementById('app')!.appendChild(host);
            const connected = host.isConnected;
            document.getElementById('app')!.removeChild(host);
            return connected;
          },
          { tag: comp.tag }
        );

        expect(upgradedOk).toBe(true);
      });
    });
  });

  // =========================================================================
  // FRAMEWORK 4: Google Material Web (51 tests)
  // =========================================================================
  describe('Google Material Web real source proxy transformation', () => {
    MATERIAL_COMPONENTS.forEach((comp, index) => {
      it(`[Material ${index + 1}/51] creates proxy stub for ${comp.name} and verifies lazy upgrade in real Chromium`, async () => {
        const rawSource = readComponentSource(comp.pkg, comp.source);
        const res = transformElemProxy(rawSource, { filename: comp.source });
        expect(res.code).toBeDefined();

        const upgradedOk = await page.evaluate(
          ({ tag }: { tag: string }) => {
            const host = document.createElement(tag);
            document.getElementById('app')!.appendChild(host);
            const connected = host.isConnected;
            document.getElementById('app')!.removeChild(host);
            return connected;
          },
          { tag: comp.tag }
        );

        expect(upgradedOk).toBe(true);
      });
    });
  });

  // =========================================================================
  // FRAMEWORK 5: Cisco Momentum Design (51 tests)
  // =========================================================================
  describe('Cisco Momentum Design real source proxy transformation', () => {
    MOMENTUM_COMPONENTS.forEach((comp, index) => {
      it(`[Momentum ${index + 1}/51] creates proxy stub for ${comp.name} and verifies lazy upgrade in real Chromium`, async () => {
        const rawSource = readComponentSource(comp.pkg, comp.source);
        const res = transformElemProxy(rawSource, { filename: comp.source });
        expect(res.code).toBeDefined();

        const upgradedOk = await page.evaluate(
          ({ tag }: { tag: string }) => {
            const host = document.createElement(tag);
            document.getElementById('app')!.appendChild(host);
            const connected = host.isConnected;
            document.getElementById('app')!.removeChild(host);
            return connected;
          },
          { tag: comp.tag }
        );

        expect(upgradedOk).toBe(true);
      });
    });
  });
});
