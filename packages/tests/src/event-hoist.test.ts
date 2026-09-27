import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { transformEventHoist, SAFE_BUBBLING_EVENTS } from '@lit-core/event-hoist';
import {
  CARBON_COMPONENTS,
  SPECTRUM_COMPONENTS,
  WEBAWESOME_COMPONENTS,
  MATERIAL_COMPONENTS,
  MOMENTUM_COMPONENTS,
} from './components.js';
import { readComponentSource } from './fixtures.js';
import { getTestBrowser } from './harness.js';

describe('event-hoist playwright multi-framework test suite', () => {
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
  describe('Carbon Web Components real source event hoisting & delegation', () => {
    CARBON_COMPONENTS.forEach((comp, index) => {
      it(`[Carbon ${index + 1}/51] hoists event bindings in real source for ${comp.name} and delegates in real Chromium`, async () => {
        const rawSource = readComponentSource(comp.pkg, comp.source);
        const res = transformEventHoist(rawSource, { filename: comp.source });
        expect(res.code).toBeDefined();

        const fired = await page.evaluate(
          ({ tag }: { tag: string }) => {
            const host = document.createElement(tag);
            const shadow = host.attachShadow({ mode: 'open' });
            const btn = document.createElement('button');
            btn.className = 'inner-action';
            shadow.appendChild(btn);

            let clickCount = 0;
            host.addEventListener('click', () => {
              clickCount++;
            });

            document.getElementById('app')!.appendChild(host);
            btn.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
            document.getElementById('app')!.removeChild(host);
            return clickCount === 1;
          },
          { tag: comp.tag }
        );

        expect(fired).toBe(true);
      });
    });
  });

  // =========================================================================
  // FRAMEWORK 2: Spectrum Web Components (51 tests)
  // =========================================================================
  describe('Spectrum Web Components real source event hoisting & delegation', () => {
    SPECTRUM_COMPONENTS.forEach((comp, index) => {
      it(`[Spectrum ${index + 1}/51] hoists event bindings in real source for ${comp.name} and delegates in real Chromium`, async () => {
        const rawSource = readComponentSource(comp.pkg, comp.source);
        const res = transformEventHoist(rawSource, { filename: comp.source });
        expect(res.code).toBeDefined();

        const fired = await page.evaluate(
          ({ tag }: { tag: string }) => {
            const host = document.createElement(tag);
            const shadow = host.attachShadow({ mode: 'open' });
            const btn = document.createElement('button');
            btn.className = 'inner-action';
            shadow.appendChild(btn);

            let clickCount = 0;
            host.addEventListener('click', () => {
              clickCount++;
            });

            document.getElementById('app')!.appendChild(host);
            btn.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
            document.getElementById('app')!.removeChild(host);
            return clickCount === 1;
          },
          { tag: comp.tag }
        );

        expect(fired).toBe(true);
      });
    });
  });

  // =========================================================================
  // FRAMEWORK 3: Web Awesome (51 tests)
  // =========================================================================
  describe('Web Awesome real source event hoisting & delegation', () => {
    WEBAWESOME_COMPONENTS.forEach((comp, index) => {
      it(`[Web Awesome ${index + 1}/51] hoists event bindings in real source for ${comp.name} and delegates in real Chromium`, async () => {
        const rawSource = readComponentSource(comp.pkg, comp.source);
        const res = transformEventHoist(rawSource, { filename: comp.source });
        expect(res.code).toBeDefined();

        const fired = await page.evaluate(
          ({ tag }: { tag: string }) => {
            const host = document.createElement(tag);
            const shadow = host.attachShadow({ mode: 'open' });
            const btn = document.createElement('button');
            btn.className = 'inner-action';
            shadow.appendChild(btn);

            let clickCount = 0;
            host.addEventListener('click', () => {
              clickCount++;
            });

            document.getElementById('app')!.appendChild(host);
            btn.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
            document.getElementById('app')!.removeChild(host);
            return clickCount === 1;
          },
          { tag: comp.tag }
        );

        expect(fired).toBe(true);
      });
    });
  });

  // =========================================================================
  // FRAMEWORK 4: Google Material Web (51 tests)
  // =========================================================================
  describe('Google Material Web real source event hoisting & delegation', () => {
    MATERIAL_COMPONENTS.forEach((comp, index) => {
      it(`[Material ${index + 1}/51] hoists event bindings in real source for ${comp.name} and delegates in real Chromium`, async () => {
        const rawSource = readComponentSource(comp.pkg, comp.source);
        const res = transformEventHoist(rawSource, { filename: comp.source });
        expect(res.code).toBeDefined();

        const fired = await page.evaluate(
          ({ tag }: { tag: string }) => {
            const host = document.createElement(tag);
            const shadow = host.attachShadow({ mode: 'open' });
            const btn = document.createElement('button');
            btn.className = 'inner-action';
            shadow.appendChild(btn);

            let clickCount = 0;
            host.addEventListener('click', () => {
              clickCount++;
            });

            document.getElementById('app')!.appendChild(host);
            btn.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
            document.getElementById('app')!.removeChild(host);
            return clickCount === 1;
          },
          { tag: comp.tag }
        );

        expect(fired).toBe(true);
      });
    });
  });

  // =========================================================================
  // FRAMEWORK 5: Cisco Momentum Design (51 tests)
  // =========================================================================
  describe('Cisco Momentum Design real source event hoisting & delegation', () => {
    MOMENTUM_COMPONENTS.forEach((comp, index) => {
      it(`[Momentum ${index + 1}/51] hoists event bindings in real source for ${comp.name} and delegates in real Chromium`, async () => {
        const rawSource = readComponentSource(comp.pkg, comp.source);
        const res = transformEventHoist(rawSource, { filename: comp.source });
        expect(res.code).toBeDefined();

        const fired = await page.evaluate(
          ({ tag }: { tag: string }) => {
            const host = document.createElement(tag);
            const shadow = host.attachShadow({ mode: 'open' });
            const btn = document.createElement('button');
            btn.className = 'inner-action';
            shadow.appendChild(btn);

            let clickCount = 0;
            host.addEventListener('click', () => {
              clickCount++;
            });

            document.getElementById('app')!.appendChild(host);
            btn.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
            document.getElementById('app')!.removeChild(host);
            return clickCount === 1;
          },
          { tag: comp.tag }
        );

        expect(fired).toBe(true);
      });
    });
  });
});
