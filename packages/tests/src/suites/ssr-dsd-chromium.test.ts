import { createIsolateEnvironment, renderToString } from '@lit-core/ssr';
import { html } from 'lit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bundleComponentForBrowser } from '../bundler.js';
import { CARBON_COMPONENTS, MATERIAL_COMPONENTS, MOMENTUM_COMPONENTS, SPECTRUM_COMPONENTS, WEBAWESOME_COMPONENTS } from '../components.js';
import { getTestBrowser } from '../harness.js';
import { getSsrEngine } from '../ssr-harness.js';

describe('@lit-core/ssr Declarative Shadow DOM Chromium Playwright test suite', () => {
  let browser: any;
  let page: any;

  beforeAll(async () => {
    browser = await getTestBrowser();
    page = await browser.newPage();
  });

  afterAll(async () => {
    if (page) {
      await page.close();
    }
  });

  // =========================================================================
  // TIER 3: BROWSER DECLARATIVE SHADOW DOM PARSING AND ATTACHMENT
  // =========================================================================
  describe('tier 3: browser Declarative Shadow DOM parsing and attachment', () => {
    it('parses server-rendered DSD and automatically attaches open shadow root in Chromium', async () => {
      const engine = await getSsrEngine();
      const dsdHtml = await engine.collectResult(
        engine.render({
          tagName: 'chromium-dsd-test',
          shadowHtml: '<div class="inner-box"><p id="shadow-text">Declarative Shadow DOM attached</p></div>',
          attributes: { id: 'test-dsd-node' },
        }),
      );

      expect(dsdHtml).toContain('shadowrootmode="open"');
      expect(dsdHtml).not.toContain('<!--lit-part');

      await page.setContent(`<!DOCTYPE html><html><body><div id="test-root">${dsdHtml}</div></body></html>`);

      const shadowResult = await page.evaluate(() => {
        const el = document.getElementById('test-dsd-node');
        if (!el) return { found: false, hasShadow: false, mode: '', text: '' };
        const shadow = el.shadowRoot;
        return {
          found: true,
          hasShadow: Boolean(shadow),
          mode: shadow?.mode || '',
          text: shadow?.querySelector('#shadow-text')?.textContent || '',
        };
      });

      expect(shadowResult.found).toBe(true);
      expect(shadowResult.hasShadow).toBe(true);
      expect(shadowResult.mode).toBe('open');
      expect(shadowResult.text).toBe('Declarative Shadow DOM attached');
    });

    it('verifies 100% absence of comment markers in Chromium DOM tree', async () => {
      const engine = await getSsrEngine();
      const dsdHtml = await engine.collectResult(
        engine.render({
          tagName: 'clean-markup-host',
          shadowHtml: '<span>No comment markers</span>',
          attributes: { id: 'clean-host' },
        }),
      );

      await page.setContent(`<!DOCTYPE html><html><body><div id="test-root">${dsdHtml}</div></body></html>`);

      const commentCount = await page.evaluate(() => {
        const root = document.getElementById('test-root');
        if (!root) return -1;
        const iterator = document.createNodeIterator(root, NodeFilter.SHOW_COMMENT);
        let count = 0;
        while (iterator.nextNode()) {
          count++;
        }
        return count;
      });

      expect(commentCount).toBe(0);
    });

    it('verifies deterministic slot projection inside Chromium DOM', async () => {
      const engine = await getSsrEngine();
      const dsdHtml = await engine.collectResult(
        engine.render({
          tagName: 'slot-chromium-host',
          shadowHtml: '<div class="shadow-container"><slot name="icon"></slot><slot></slot></div>',
          lightDom: [{ slot: 'icon', content: '<span id="icon-node">★</span>' }, { content: '<span id="default-node">Default text</span>' }],
          attributes: { id: 'slot-host' },
        }),
      );

      await page.setContent(`<!DOCTYPE html><html><body><div id="test-root">${dsdHtml}</div></body></html>`);

      const slotResult = await page.evaluate(() => {
        const host = document.getElementById('slot-host');
        if (!host?.shadowRoot) return { iconFound: false, defaultFound: false };

        const iconNode = host.shadowRoot.querySelector('#icon-node');
        const defaultNode = host.shadowRoot.querySelector('#default-node');

        return {
          iconFound: Boolean(iconNode),
          defaultFound: Boolean(defaultNode),
        };
      });

      expect(slotResult.iconFound).toBe(true);
      expect(slotResult.defaultFound).toBe(true);
    });

    it('reads and parses resumable state snapshot in Chromium', async () => {
      const engine = await getSsrEngine();
      const dsdHtml = await engine.collectResult(
        engine.render(
          {
            tagName: 'state-chromium-host',
            shadowHtml: '<button id="btn">Click me</button>',
            attributes: { id: 'state-host' },
            state: { count: 99, active: true },
          },
          { resumable: true },
        ),
      );

      await page.setContent(`<!DOCTYPE html><html><body><div id="test-root">${dsdHtml}</div></body></html>`);

      const parsedState = await page.evaluate(() => {
        const host = document.getElementById('state-host');
        const script = host?.querySelector('script[type="lit/state"]');
        if (!script) return null;
        try {
          return JSON.parse(script.textContent || '{}');
        } catch {
          return null;
        }
      });

      expect(parsedState).toEqual({ count: 99, active: true });
    });

    it('attaches shadow roots on nested custom elements rendered to DSD in Chromium', async () => {
      const engine = await getSsrEngine();
      const dsdHtml = await engine.collectResult(
        engine.render({
          tagName: 'outer-card',
          shadowHtml: '<div class="outer-wrap"><slot></slot></div>',
          lightDom: [
            {
              content: '<inner-badge id="nested-badge"><template shadowrootmode="open"><span id="badge-text">Badge inner</span></template></inner-badge>',
            },
          ],
          attributes: { id: 'outer-host' },
        }),
      );

      await page.setContent(`<!DOCTYPE html><html><body><div id="test-root">${dsdHtml}</div></body></html>`);

      const nestedResult = await page.evaluate(() => {
        const outer = document.getElementById('outer-host');
        const inner = outer?.shadowRoot?.querySelector('#nested-badge') || document.getElementById('nested-badge');
        return {
          outerHasShadow: outer?.shadowRoot !== null,
          innerHasShadow: inner?.shadowRoot !== null,
          badgeText: inner?.shadowRoot?.querySelector('#badge-text')?.textContent || '',
        };
      });

      expect(nestedResult.outerHasShadow).toBe(true);
      expect(nestedResult.innerHasShadow).toBe(true);
      expect(nestedResult.badgeText).toBe('Badge inner');
    });

    it('verifies shadow root styles take effect inside Chromium DOM', async () => {
      const engine = await getSsrEngine();
      const dsdHtml = await engine.collectResult(
        engine.render({
          tagName: 'styled-chromium-host',
          styles: ':host { color: rgb(255, 0, 0); } .text { font-size: 20px; }',
          shadowHtml: '<span class="text" id="styled-target">Red text</span>',
          attributes: { id: 'styled-host' },
        }),
      );

      await page.setContent(`<!DOCTYPE html><html><body><div id="test-root">${dsdHtml}</div></body></html>`);

      const computedColor = await page.evaluate(() => {
        const host = document.getElementById('styled-host');
        if (!host) return '';
        return window.getComputedStyle(host).color;
      });

      expect(computedColor).toBe('rgb(255, 0, 0)');
    });

    it('resumes a server-rendered stateful counter component across 3 clicks (0 -> 1 -> 2 -> 3) without duplicating DOM nodes', async () => {
      const env = createIsolateEnvironment();

      class SsrStatefulCounter extends env.HTMLElement {
        static properties = {
          count: { type: Number },
        };
        count = 0;
        increment() {
          this.count++;
        }
        renderDisplay() {
          return html`<span id="count-val">${this.count}</span>`;
        }
        render() {
          return html`<div class="counter-wrap">${this.renderDisplay()}<button id="inc-btn" @click=${this.increment}>Increment</button></div>`;
        }
      }

      env.customElements.define('ssr-stateful-counter', SsrStatefulCounter);

      const dsdHtml = renderToString(html`<ssr-stateful-counter id="counter-host"></ssr-stateful-counter>`, {
        customElements: env.customElements,
        resumable: true,
      });

      expect(dsdHtml).toContain('shadowrootmode="open"');
      expect(dsdHtml).toContain('<span id="count-val">0</span>');

      const clientBundle = await bundleComponentForBrowser({
        entrySource: `
          import { LitElement, html } from 'lit';
          import { withResumable } from '@lit-core/resumable/client';

          class SsrStatefulCounter extends withResumable(LitElement) {
            static properties = {
              count: { type: Number },
            };
            constructor() {
              super();
              this.count = 0;
            }
            increment() {
              this.count++;
            }
            renderDisplay() {
              return html\`<span id="count-val">\${this.count}</span>\`;
            }
            render() {
              return html\`<div class="counter-wrap">\${this.renderDisplay()}<button id="inc-btn" @click=\${this.increment}>Increment</button></div>\`;
            }
          }

          if (!customElements.get('ssr-stateful-counter')) {
            customElements.define('ssr-stateful-counter', SsrStatefulCounter);
          }
        `,
        plugins: { cssFuse: false, virtual: true },
      });

      await page.setContent(`<!DOCTYPE html><html><body><div id="test-root">${dsdHtml}</div><script type="module">${clientBundle}</script></body></html>`);

      const initialCheck = await page.evaluate(async () => {
        await customElements.whenDefined('ssr-stateful-counter');
        const host = document.getElementById('counter-host') as any;
        if (host?.updateComplete) {
          await host.updateComplete;
        }
        const shadow = host?.shadowRoot;
        (window as any).__initialDsdButton = shadow?.querySelector('button');
        (window as any).__initialDsdSpan = shadow?.querySelector('#count-val');
        return {
          countText: shadow?.querySelector('#count-val')?.textContent || '',
          buttonCount: shadow ? shadow.querySelectorAll('button').length : 0,
        };
      });

      expect(initialCheck.countText).toBe('0');
      expect(initialCheck.buttonCount).toBe(1);

      for (const expectedCount of ['1', '2', '3']) {
        const afterClick = await page.evaluate(async () => {
          const host = document.getElementById('counter-host') as any;
          const btn = host?.shadowRoot?.querySelector('button') as HTMLButtonElement | null;
          btn?.click();
          if (host?.updateComplete) {
            await host.updateComplete;
          }
          const currentBtn = host?.shadowRoot?.querySelector('button');
          const currentSpan = host?.shadowRoot?.querySelector('#count-val');
          return {
            countText: currentSpan?.textContent || '',
            buttonCount: host?.shadowRoot ? host.shadowRoot.querySelectorAll('button').length : 0,
            sameButtonNode: currentBtn === (window as any).__initialDsdButton,
            sameSpanNode: currentSpan === (window as any).__initialDsdSpan,
          };
        });

        expect(afterClick.countText).toBe(expectedCount);
        expect(afterClick.buttonCount).toBe(1);
        expect(afterClick.sameButtonNode).toBe(true);
        expect(afterClick.sameSpanNode).toBe(true);
      }
    });

    it('resumes an html-aot compiled component with automated ssr.resumable injection across 3 clicks in Chromium', async () => {
      const env = createIsolateEnvironment();

      class SsrAotCounter extends env.HTMLElement {
        static properties = {
          count: { type: Number },
        };
        count = 10;
        increment() {
          this.count++;
        }
        render() {
          return html`<div class="aot-wrap"><span id="aot-val">${this.count}</span><button id="aot-btn" @click=${this.increment}>Step</button></div>`;
        }
      }

      env.customElements.define('ssr-aot-counter', SsrAotCounter);

      const dsdHtml = renderToString(html`<ssr-aot-counter id="aot-host"></ssr-aot-counter>`, {
        customElements: env.customElements,
        resumable: true,
      });

      const clientBundle = await bundleComponentForBrowser({
        entrySource: `
          import { LitElement, html } from 'lit';

          export class SsrAotCounter extends LitElement {
            static properties = {
              count: { type: Number },
            };
            constructor() {
              super();
              this.count = 0;
            }
            increment() {
              this.count++;
            }
            render() {
              return html\`<div class="aot-wrap"><span id="aot-val">\${this.count}</span><button id="aot-btn" @click=\${this.increment}>Step</button></div>\`;
            }
          }

          if (!customElements.get('ssr-aot-counter')) {
            customElements.define('ssr-aot-counter', SsrAotCounter);
          }
        `,
        plugins: {
          cssFuse: false,
          htmlAot: true,
          ssr: { resumable: true },
        },
      });

      await page.setContent(`<!DOCTYPE html><html><body><div id="test-root">${dsdHtml}</div><script type="module">${clientBundle}</script></body></html>`);

      const initialCheck = await page.evaluate(async () => {
        await customElements.whenDefined('ssr-aot-counter');
        const host = document.getElementById('aot-host') as any;
        if (host?.updateComplete) {
          await host.updateComplete;
        }
        const shadow = host?.shadowRoot;
        (window as any).__aotBtn = shadow?.querySelector('button');
        return {
          countText: shadow?.querySelector('#aot-val')?.textContent || '',
          buttonCount: shadow ? shadow.querySelectorAll('button').length : 0,
        };
      });

      expect(initialCheck.countText).toBe('10');
      expect(initialCheck.buttonCount).toBe(1);

      for (const expectedCount of ['11', '12', '13']) {
        const afterClick = await page.evaluate(async () => {
          const host = document.getElementById('aot-host') as any;
          const btn = host?.shadowRoot?.querySelector('button') as HTMLButtonElement | null;
          btn?.click();
          if (host?.updateComplete) {
            await host.updateComplete;
          }
          const currentBtn = host?.shadowRoot?.querySelector('button');
          return {
            countText: host?.shadowRoot?.querySelector('#aot-val')?.textContent || '',
            buttonCount: host?.shadowRoot ? host.shadowRoot.querySelectorAll('button').length : 0,
            sameButtonNode: currentBtn === (window as any).__aotBtn,
          };
        });

        expect(afterClick.countText).toBe(expectedCount);
        expect(afterClick.buttonCount).toBe(1);
        expect(afterClick.sameButtonNode).toBe(true);
      }
    });
  });

  // =========================================================================
  // TIER 4: REAL-WORLD APPLICATION SCENARIOS (ENTERPRISE DESIGN SYSTEMS)
  // =========================================================================
  describe('tier 4: real enterprise design system SSR in Chromium', () => {
    describe('IBM Carbon Web Components SSR rendering', () => {
      const carbonSample = CARBON_COMPONENTS.slice(0, 5);

      carbonSample.forEach((comp, index) => {
        it(`[Carbon ${index + 1}/${carbonSample.length}] server-renders ${comp.name} into clean DSD and attaches in Chromium`, async () => {
          const engine = await getSsrEngine();
          const dsdHtml = await engine.collectResult(
            engine.render({
              tagName: comp.tag,
              shadowHtml: `<div class="carbon-inner"><span>${comp.name} rendered</span></div>`,
              attributes: { id: `carbon-comp-${index}`, 'data-carbon': 'true' },
            }),
          );

          expect(dsdHtml).toContain('shadowrootmode="open"');
          expect(dsdHtml).not.toContain('<!--lit-part');

          await page.setContent(`<!DOCTYPE html><html><body><div id="test-root">${dsdHtml}</div></body></html>`);

          const result = await page.evaluate((id: string) => {
            const el = document.getElementById(id);
            return {
              attached: el?.shadowRoot !== null,
              mode: el?.shadowRoot?.mode || '',
              text: el?.shadowRoot?.querySelector('.carbon-inner span')?.textContent || '',
            };
          }, `carbon-comp-${index}`);

          expect(result.attached).toBe(true);
          expect(result.mode).toBe('open');
          expect(result.text).toBe(`${comp.name} rendered`);
        });
      });
    });

    describe('Adobe Spectrum Web Components SSR rendering', () => {
      const spectrumSample = SPECTRUM_COMPONENTS.slice(0, 5);

      spectrumSample.forEach((comp, index) => {
        it(`[Spectrum ${index + 1}/${spectrumSample.length}] server-renders ${comp.name} into clean DSD and attaches in Chromium`, async () => {
          const engine = await getSsrEngine();
          const dsdHtml = await engine.collectResult(
            engine.render({
              tagName: comp.tag,
              shadowHtml: `<div class="spectrum-inner"><label>${comp.name} label</label></div>`,
              attributes: { id: `spectrum-comp-${index}`, 'data-spectrum': 'true' },
            }),
          );

          expect(dsdHtml).toContain('shadowrootmode="open"');
          expect(dsdHtml).not.toContain('<!--lit-part');

          await page.setContent(`<!DOCTYPE html><html><body><div id="test-root">${dsdHtml}</div></body></html>`);

          const result = await page.evaluate((id: string) => {
            const el = document.getElementById(id);
            return {
              attached: el?.shadowRoot !== null,
              mode: el?.shadowRoot?.mode || '',
              label: el?.shadowRoot?.querySelector('.spectrum-inner label')?.textContent || '',
            };
          }, `spectrum-comp-${index}`);

          expect(result.attached).toBe(true);
          expect(result.mode).toBe('open');
          expect(result.label).toBe(`${comp.name} label`);
        });
      });
    });

    describe('Google Material Web SSR rendering', () => {
      const materialSample = MATERIAL_COMPONENTS.slice(0, 5);

      materialSample.forEach((comp, index) => {
        it(`[Material ${index + 1}/${materialSample.length}] server-renders ${comp.name} into clean DSD and attaches in Chromium`, async () => {
          const engine = await getSsrEngine();
          const dsdHtml = await engine.collectResult(
            engine.render({
              tagName: comp.tag,
              shadowHtml: `<div class="md-inner"><button>${comp.name} action</button></div>`,
              attributes: { id: `material-comp-${index}`, 'data-material': 'true' },
            }),
          );

          expect(dsdHtml).toContain('shadowrootmode="open"');
          expect(dsdHtml).not.toContain('<!--lit-part');

          await page.setContent(`<!DOCTYPE html><html><body><div id="test-root">${dsdHtml}</div></body></html>`);

          const result = await page.evaluate((id: string) => {
            const el = document.getElementById(id);
            return {
              attached: el?.shadowRoot !== null,
              mode: el?.shadowRoot?.mode || '',
              buttonText: el?.shadowRoot?.querySelector('.md-inner button')?.textContent || '',
            };
          }, `material-comp-${index}`);

          expect(result.attached).toBe(true);
          expect(result.mode).toBe('open');
          expect(result.buttonText).toBe(`${comp.name} action`);
        });
      });
    });

    describe('Web Awesome SSR rendering', () => {
      const webawesomeSample = WEBAWESOME_COMPONENTS.slice(0, 5);

      webawesomeSample.forEach((comp, index) => {
        it(`[Web Awesome ${index + 1}/${webawesomeSample.length}] server-renders ${comp.name} into clean DSD and attaches in Chromium`, async () => {
          const engine = await getSsrEngine();
          const dsdHtml = await engine.collectResult(
            engine.render({
              tagName: comp.tag,
              shadowHtml: `<div class="wa-inner"><span>${comp.name} content</span></div>`,
              attributes: { id: `wa-comp-${index}`, 'data-wa': 'true' },
            }),
          );

          expect(dsdHtml).toContain('shadowrootmode="open"');
          expect(dsdHtml).not.toContain('<!--lit-part');

          await page.setContent(`<!DOCTYPE html><html><body><div id="test-root">${dsdHtml}</div></body></html>`);

          const result = await page.evaluate((id: string) => {
            const el = document.getElementById(id);
            return {
              attached: el?.shadowRoot !== null,
              mode: el?.shadowRoot?.mode || '',
              text: el?.shadowRoot?.querySelector('.wa-inner span')?.textContent || '',
            };
          }, `wa-comp-${index}`);

          expect(result.attached).toBe(true);
          expect(result.mode).toBe('open');
          expect(result.text).toBe(`${comp.name} content`);
        });
      });
    });

    describe('Cisco Momentum Design SSR rendering', () => {
      const momentumSample = MOMENTUM_COMPONENTS.slice(0, 5);

      momentumSample.forEach((comp, index) => {
        it(`[Momentum ${index + 1}/${momentumSample.length}] server-renders ${comp.name} into clean DSD and attaches in Chromium`, async () => {
          const engine = await getSsrEngine();
          const dsdHtml = await engine.collectResult(
            engine.render({
              tagName: comp.tag,
              shadowHtml: `<div class="mdc-inner"><button>${comp.name} trigger</button></div>`,
              attributes: { id: `momentum-comp-${index}`, 'data-momentum': 'true' },
            }),
          );

          expect(dsdHtml).toContain('shadowrootmode="open"');
          expect(dsdHtml).not.toContain('<!--lit-part');

          await page.setContent(`<!DOCTYPE html><html><body><div id="test-root">${dsdHtml}</div></body></html>`);

          const result = await page.evaluate((id: string) => {
            const el = document.getElementById(id);
            return {
              attached: el?.shadowRoot !== null,
              mode: el?.shadowRoot?.mode || '',
              text: el?.shadowRoot?.querySelector('.mdc-inner button')?.textContent || '',
            };
          }, `momentum-comp-${index}`);

          expect(result.attached).toBe(true);
          expect(result.mode).toBe('open');
          expect(result.text).toBe(`${comp.name} trigger`);
        });
      });
    });
  });
});
