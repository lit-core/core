import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { renderToDsd } from '@lit-core/resumable/server';
import {
  CARBON_COMPONENTS,
  SPECTRUM_COMPONENTS,
  WEBAWESOME_COMPONENTS,
  MATERIAL_COMPONENTS,
  MOMENTUM_COMPONENTS,
} from './components.js';
import { getTestBrowser } from './harness.js';

describe('resumable playwright multi-framework test suite', () => {
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
  describe('Carbon Web Components DSD server-rendering & client resumption', () => {
    CARBON_COMPONENTS.forEach((comp, index) => {
      it(`[Carbon ${index + 1}/51] renders DSD for ${comp.name} and hydrates in real Chromium`, async () => {
        const dsdMarkup = renderToDsd({
          tagName: comp.tag,
          shadowHtml: '<div class="cds-resumable-inner"><span>Resumed Carbon</span></div>',
          attributes: { 'data-resumable': 'true', id: `resumed-cds-${index}` },
          state: { active: true, count: index },
        });

        expect(dsdMarkup).toContain('shadowrootmode="open"');
        expect(dsdMarkup).toContain(comp.tag);

        const hydrated = await page.evaluate(
          ({ markup, id }: { markup: string; id: string }) => {
            const container = document.getElementById('app')!;
            if (typeof (container as any).setHTMLUnsafe === 'function') {
              (container as any).setHTMLUnsafe(markup);
            } else {
              container.innerHTML = markup;
            }
            const el = document.getElementById(id);
            const hasShadow = el?.shadowRoot !== null;
            const text = el?.shadowRoot?.querySelector('.cds-resumable-inner')?.textContent;
            container.innerHTML = '';
            return hasShadow && text === 'Resumed Carbon';
          },
          { markup: dsdMarkup, id: `resumed-cds-${index}` }
        );

        expect(hydrated).toBe(true);
      });
    });
  });

  // =========================================================================
  // FRAMEWORK 2: Spectrum Web Components (51 tests)
  // =========================================================================
  describe('Spectrum Web Components DSD server-rendering & client resumption', () => {
    SPECTRUM_COMPONENTS.forEach((comp, index) => {
      it(`[Spectrum ${index + 1}/51] renders DSD for ${comp.name} and hydrates in real Chromium`, async () => {
        const dsdMarkup = renderToDsd({
          tagName: comp.tag,
          shadowHtml: '<div class="sp-resumable-inner"><span>Resumed Spectrum</span></div>',
          attributes: { 'data-resumable': 'true', id: `resumed-sp-${index}` },
          state: { active: true, index },
        });

        expect(dsdMarkup).toContain('shadowrootmode="open"');
        expect(dsdMarkup).toContain(comp.tag);

        const hydrated = await page.evaluate(
          ({ markup, id }: { markup: string; id: string }) => {
            const container = document.getElementById('app')!;
            if (typeof (container as any).setHTMLUnsafe === 'function') {
              (container as any).setHTMLUnsafe(markup);
            } else {
              container.innerHTML = markup;
            }
            const el = document.getElementById(id);
            const hasShadow = el?.shadowRoot !== null;
            const text = el?.shadowRoot?.querySelector('.sp-resumable-inner')?.textContent;
            container.innerHTML = '';
            return hasShadow && text === 'Resumed Spectrum';
          },
          { markup: dsdMarkup, id: `resumed-sp-${index}` }
        );

        expect(hydrated).toBe(true);
      });
    });
  });

  // =========================================================================
  // FRAMEWORK 3: Web Awesome (51 tests)
  // =========================================================================
  describe('Web Awesome DSD server-rendering & client resumption', () => {
    WEBAWESOME_COMPONENTS.forEach((comp, index) => {
      it(`[Web Awesome ${index + 1}/51] renders DSD for ${comp.name} and hydrates in real Chromium`, async () => {
        const dsdMarkup = renderToDsd({
          tagName: comp.tag,
          shadowHtml: '<div class="wa-resumable-inner"><span>Resumed Awesome</span></div>',
          attributes: { 'data-resumable': 'true', id: `resumed-wa-${index}` },
          state: { loaded: true, key: `item-${index}` },
        });

        expect(dsdMarkup).toContain('shadowrootmode="open"');
        expect(dsdMarkup).toContain(comp.tag);

        const hydrated = await page.evaluate(
          ({ markup, id }: { markup: string; id: string }) => {
            const container = document.getElementById('app')!;
            if (typeof (container as any).setHTMLUnsafe === 'function') {
              (container as any).setHTMLUnsafe(markup);
            } else {
              container.innerHTML = markup;
            }
            const el = document.getElementById(id);
            const hasShadow = el?.shadowRoot !== null;
            const text = el?.shadowRoot?.querySelector('.wa-resumable-inner')?.textContent;
            container.innerHTML = '';
            return hasShadow && text === 'Resumed Awesome';
          },
          { markup: dsdMarkup, id: `resumed-wa-${index}` }
        );

        expect(hydrated).toBe(true);
      });
    });
  });

  // =========================================================================
  // FRAMEWORK 4: Google Material Web (51 tests)
  // =========================================================================
  describe('Google Material Web DSD server-rendering & client resumption', () => {
    MATERIAL_COMPONENTS.forEach((comp, index) => {
      it(`[Material ${index + 1}/51] renders DSD for ${comp.name} and hydrates in real Chromium`, async () => {
        const dsdMarkup = renderToDsd({
          tagName: comp.tag,
          shadowHtml: '<div class="md-resumable-inner"><span>Resumed Material</span></div>',
          attributes: { 'data-resumable': 'true', id: `resumed-md-${index}` },
          state: { selected: true, order: index },
        });

        expect(dsdMarkup).toContain('shadowrootmode="open"');
        expect(dsdMarkup).toContain(comp.tag);

        const hydrated = await page.evaluate(
          ({ markup, id }: { markup: string; id: string }) => {
            const container = document.getElementById('app')!;
            if (typeof (container as any).setHTMLUnsafe === 'function') {
              (container as any).setHTMLUnsafe(markup);
            } else {
              container.innerHTML = markup;
            }
            const el = document.getElementById(id);
            const hasShadow = el?.shadowRoot !== null;
            const text = el?.shadowRoot?.querySelector('.md-resumable-inner')?.textContent;
            container.innerHTML = '';
            return hasShadow && text === 'Resumed Material';
          },
          { markup: dsdMarkup, id: `resumed-md-${index}` }
        );

        expect(hydrated).toBe(true);
      });
    });
  });

  // =========================================================================
  // FRAMEWORK 5: Cisco Momentum Design (51 tests)
  // =========================================================================
  describe('Cisco Momentum Design DSD server-rendering & client resumption', () => {
    MOMENTUM_COMPONENTS.forEach((comp, index) => {
      it(`[Momentum ${index + 1}/51] renders DSD for ${comp.name} and hydrates in real Chromium`, async () => {
        const dsdMarkup = renderToDsd({
          tagName: comp.tag,
          shadowHtml: '<div class="mdc-resumable-inner"><span>Resumed Momentum</span></div>',
          attributes: { 'data-resumable': 'true', id: `resumed-mdc-${index}` },
          state: { expanded: false, step: index },
        });

        expect(dsdMarkup).toContain('shadowrootmode="open"');
        expect(dsdMarkup).toContain(comp.tag);

        const hydrated = await page.evaluate(
          ({ markup, id }: { markup: string; id: string }) => {
            const container = document.getElementById('app')!;
            if (typeof (container as any).setHTMLUnsafe === 'function') {
              (container as any).setHTMLUnsafe(markup);
            } else {
              container.innerHTML = markup;
            }
            const el = document.getElementById(id);
            const hasShadow = el?.shadowRoot !== null;
            const text = el?.shadowRoot?.querySelector('.mdc-resumable-inner')?.textContent;
            container.innerHTML = '';
            return hasShadow && text === 'Resumed Momentum';
          },
          { markup: dsdMarkup, id: `resumed-mdc-${index}` }
        );

        expect(hydrated).toBe(true);
      });
    });
  });
});
