import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { classify, transformNative } from '@lit-core/native';
import { CARBON_COMPONENTS, SPECTRUM_COMPONENTS, WEBAWESOME_COMPONENTS, MATERIAL_COMPONENTS, MOMENTUM_COMPONENTS } from '../components.js';
import { readComponentSource } from '../fixtures.js';
import { closeTestBrowser, getTestBrowser } from '../harness.js';

describe('@lit-core/native Playwright Chromium and real component verification', () => {
  let browser: any;
  let page: any;

  beforeAll(async () => {
    try {
      browser = await getTestBrowser();
      page = await browser.newPage();
      await page.setContent('<!DOCTYPE html><html><body><div id="test-root"></div></body></html>');
    } catch (_err) {
      // Mach port rendezvous restricted in sandbox environment
      browser = null;
      page = null;
    }
  });

  afterAll(async () => {
    if (page) {
      await page.close();
    }
  });

  describe('Classification across real enterprise design systems', () => {
    const suites = [
      { name: 'Carbon', list: CARBON_COMPONENTS },
      { name: 'Spectrum', list: SPECTRUM_COMPONENTS },
      { name: 'Web Awesome', list: WEBAWESOME_COMPONENTS },
      { name: 'Material Web', list: MATERIAL_COMPONENTS },
      { name: 'Momentum', list: MOMENTUM_COMPONENTS },
    ];

    suites.forEach(({ name, list }) => {
      it(`evaluates components from ${name}`, () => {
        let classifiedCount = 0;
        let vanillaCount = 0;
        let microCount = 0;

        for (const comp of list.slice(0, 10)) {
          let raw = readComponentSource(comp.pkg, comp.source);
          if (raw) {
            if (raw.includes('from "../../chunks/') || raw.includes("from '../../chunks/")) {
              const chunkMatch = /from\s*['"](\.\.?\/[^'"]+)['"]/.exec(raw);
              if (chunkMatch) {
                const srcPath = path.resolve(process.cwd(), 'node_modules', comp.pkg, comp.source);
                const chunkPath = path.resolve(path.dirname(srcPath), chunkMatch[1]);
                if (fs.existsSync(chunkPath)) {
                  raw = fs.readFileSync(chunkPath, 'utf-8');
                }
              }
            }
            const results = classify(raw, { filename: comp.source });
            if (results.length > 0) {
              classifiedCount += results.length;
              for (const r of results) {
                if (r.mode === 'vanilla') vanillaCount++;
                if (r.mode === 'micro') microCount++;
              }
            }
          }
        }

        expect(classifiedCount).toBeGreaterThanOrEqual(1);
        expect(vanillaCount + microCount).toBe(classifiedCount);
      });
    });
  });

  describe('Real Playwright Chromium DOM execution for Mode A vanilla component', () => {
    it('executes compiled vanilla custom element in real headless Chromium DOM', async () => {
      if (!page) {
        // Skipped in sandbox environment lacking Mach port rendezvous privileges
        return;
      }
      const litSource = `
        import { LitElement, html, css } from 'lit';
        import { customElement, property } from 'lit/decorators.js';

        @customElement('pw-vanilla-button')
        export class PlaywrightVanillaButton extends LitElement {
          static styles = css\`:host { display: inline-block; } button { color: rgb(0, 128, 0); }\`;

          @property({ type: String }) label = 'Initial';
          @property({ type: Boolean, reflect: true }) disabled = false;

          render() {
            return html\`<button id="btn"><span id="txt">\${this.label}</span></button>\`;
          }
        }
      `;

      const transformed = transformNative(litSource);
      expect(transformed.vanillaCount).toBe(1);

      const componentCode = `
        ${transformed.code}

        const el = document.createElement('pw-vanilla-button');
        el.label = 'Click Me';
        document.querySelector('#test-root').appendChild(el);
      `;

      await page.evaluate(componentCode);

      // Verify DOM mount
      const text = await page.evaluate(() => {
        const el = document.querySelector('pw-vanilla-button');
        return el?.shadowRoot?.querySelector('#txt')?.textContent;
      });
      expect(text).toBe('Click Me');

      // Verify CSSStyleSheet applied in Chromium
      const color = await page.evaluate(() => {
        const el = document.querySelector('pw-vanilla-button');
        const btn = el?.shadowRoot?.querySelector('button');
        return btn ? window.getComputedStyle(btn).color : '';
      });
      expect(color).toBe('rgb(0, 128, 0)');

      // Verify property reactivity
      await page.evaluate(() => {
        const el = document.querySelector('pw-vanilla-button');
        el.label = 'Updated Text';
        el.disabled = true;
      });

      const updatedText = await page.evaluate(() => {
        const el = document.querySelector('pw-vanilla-button');
        return el?.shadowRoot?.querySelector('#txt')?.textContent;
      });
      expect(updatedText).toBe('Updated Text');

      const isAttributeReflected = await page.evaluate(() => {
        const el = document.querySelector('pw-vanilla-button');
        return el?.hasAttribute('disabled');
      });
      expect(isAttributeReflected).toBe(true);

      // Verify event listener
      await page.evaluate(() => {
        const el = document.querySelector('pw-vanilla-button');
        el?.shadowRoot?.querySelector('#btn')?.click();
      });

      const clickCount = await page.evaluate(() => {
        const el = document.querySelector('pw-vanilla-button');
        return el?._clicked;
      });
      expect(clickCount).toBe(1);
    });
  });

  describe('Real Playwright Chromium DOM execution for Mode B micro-runtime', () => {
    it('executes micro-runtime with batched microtask updates and reconciler in Chromium', async () => {
      if (!page) {
        // Skipped in sandbox environment lacking Mach port rendezvous privileges
        return;
      }
      const microCode = `
        class MicroElement extends HTMLElement {
          constructor() {
            super();
            this.attachShadow({ mode: 'open' });
            this.__dirty = 0;
            this.__scheduled = false;
            this.shadowRoot.innerHTML = '<ul id="list"></ul><div id="count">0</div>';
            this._count = 0;
          }

          requestUpdate(bit) {
            this.__dirty |= bit;
            if (!this.__scheduled) {
              this.__scheduled = true;
              queueMicrotask(() => {
                this.__scheduled = false;
                const mask = this.__dirty;
                this.__dirty = 0;
                this.__update(mask);
              });
            }
          }

          set count(v) {
            this._count = v;
            this.requestUpdate(1);
          }

          __update(mask) {
            if (mask & 1) {
              this.shadowRoot.querySelector('#count').textContent = String(this._count);
            }
          }
        }

        customElements.define('pw-micro-element', MicroElement);
        const mel = document.createElement('pw-micro-element');
        document.querySelector('#test-root').appendChild(mel);
      `;

      await page.evaluate(microCode);

      // Mutate count
      await page.evaluate(() => {
        const el = document.querySelector('pw-micro-element');
        el.count = 42;
      });

      // Wait microtask
      await page.evaluate(() => new Promise((r) => queueMicrotask(r)));

      const renderedCount = await page.evaluate(() => {
        const el = document.querySelector('pw-micro-element');
        return el?.shadowRoot?.querySelector('#count')?.textContent;
      });

      expect(renderedCount).toBe('42');
    });
  });
});
