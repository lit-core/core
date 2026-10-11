import fs from 'node:fs';
import path from 'node:path';
import { classify, NATIVE_RUNTIME_SOURCE, transformNative } from '@lit-core/native';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CARBON_COMPONENTS, MATERIAL_COMPONENTS, MOMENTUM_COMPONENTS, SPECTRUM_COMPONENTS, WEBAWESOME_COMPONENTS } from '../components.js';
import { readComponentSource, resolvePackageDir } from '../fixtures.js';
import { getTestBrowser } from '../harness.js';

describe('@lit-core/native Playwright Chromium and real component verification', () => {
  let browser: any;
  let page: any;

  beforeAll(async () => {
    browser = await getTestBrowser();
    page = await browser.newPage();
    await page.setContent('<!DOCTYPE html><html><body><div id="test-root"></div></body></html>');
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
            if (!raw.includes('render()') && !raw.includes('render(')) {
              const chunkMatch = /from\s*['"](\.\.?\/[^'"]+)['"]/.exec(raw);
              if (chunkMatch) {
                const srcPath = path.join(resolvePackageDir(comp.pkg), comp.source);
                let chunkPath = path.resolve(path.dirname(srcPath), chunkMatch[1]);
                if (!fs.existsSync(chunkPath)) {
                  if (fs.existsSync(`${chunkPath}.js`)) chunkPath = `${chunkPath}.js`;
                  else if (fs.existsSync(`${chunkPath}.ts`)) chunkPath = `${chunkPath}.ts`;
                  else if (fs.existsSync(`${chunkPath}/index.js`)) chunkPath = `${chunkPath}/index.js`;
                }
                if (fs.existsSync(chunkPath) && fs.statSync(chunkPath).isFile()) {
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
      const canonicalSource = `
        import { LitElement, html, css } from 'lit';
        import { customElement, property } from 'lit/decorators.js';

        @customElement('cds-native-action')
        export class CDSNativeAction extends LitElement {
          static styles = css\`:host { display: inline-block; } button { color: rgb(0, 128, 0); }\`;

          @property({ type: String }) label = 'Initial';
          @property({ type: Boolean, reflect: true }) disabled = false;

          _clicked = 0;
          handleClick() {
            this._clicked++;
          }

          render() {
            return html\`<button id="btn" ?disabled=\${this.disabled} @click=\${this.handleClick}><span id="txt">\${this.label}</span></button>\`;
          }
        }
      `;

      const transformed = transformNative(canonicalSource, { filename: 'canonical-action.ts' });
      expect(transformed.vanillaCount).toBe(1);

      const componentCode = `
        ${transformed.code.replace(/export\s+class/, 'class')}

        const el = document.createElement('cds-native-action');
        el.label = 'Click Me';
        document.querySelector('#test-root').appendChild(el);
      `;

      await page.evaluate(componentCode);

      // Verify DOM mount
      const text = await page.evaluate(() => {
        const el = document.querySelector('cds-native-action');
        return el?.shadowRoot?.querySelector('#txt')?.textContent;
      });
      expect(text).toBe('Click Me');

      // Verify CSSStyleSheet applied in Chromium
      const color = await page.evaluate(() => {
        const el = document.querySelector('cds-native-action');
        const btn = el?.shadowRoot?.querySelector('button');
        return btn ? window.getComputedStyle(btn).color : '';
      });
      expect(color).toBe('rgb(0, 128, 0)');

      // Verify property reactivity
      await page.evaluate(() => {
        const el = document.querySelector('cds-native-action') as any;
        if (el) {
          el.label = 'Updated Text';
          el.disabled = true;
        }
      });

      const updatedText = await page.evaluate(() => {
        const el = document.querySelector('cds-native-action');
        return el?.shadowRoot?.querySelector('#txt')?.textContent;
      });
      expect(updatedText).toBe('Updated Text');

      const isAttributeReflected = await page.evaluate(() => {
        const el = document.querySelector('cds-native-action');
        return el?.hasAttribute('disabled');
      });
      expect(isAttributeReflected).toBe(true);

      // Verify event listener
      await page.evaluate(() => {
        const el = document.querySelector('cds-native-action') as any;
        el.disabled = false;
        (el?.shadowRoot?.querySelector('#btn') as any)?.click();
      });

      const clickCount = await page.evaluate(() => {
        const el = document.querySelector('cds-native-action') as any;
        return el?._clicked;
      });
      expect(clickCount).toBe(1);
    });
  });

  describe('Real Playwright Chromium DOM execution for Mode B micro-runtime', () => {
    it('executes micro-runtime with batched microtask updates and reconciler in Chromium', async () => {
      // Evaluate actual @lit-core/native runtime in Chromium page
      const runtimeCode = `
        ${NATIVE_RUNTIME_SOURCE.replace(/export\s+class/, 'class').replace(/export\s+function/, 'function')}

        class DynamicMicroCounter extends NativeElement {
          constructor() {
            super();
            this.shadowRoot.innerHTML = '<ul id="list"></ul><div id="count">0</div>';
            this._count = 0;
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

        customElements.define('dynamic-micro-counter', DynamicMicroCounter);
        const mel = document.createElement('dynamic-micro-counter');
        document.querySelector('#test-root').appendChild(mel);

        // Test keyed list reconciler from runtime
        const list = mel.shadowRoot.querySelector('#list');
        const marker = document.createTextNode('');
        list.appendChild(marker);
        const cache = new Map();
        reconcile(
          list,
          marker,
          [{ id: 1, text: 'Alpha' }, { id: 2, text: 'Beta' }],
          (i) => i.id,
          (i) => {
            const li = document.createElement('li');
            li.textContent = i.text;
            return li;
          },
          cache,
        );
      `;

      await page.evaluate(runtimeCode);

      // Verify initial keyed reconciliation output
      const listItems = await page.evaluate(() => {
        const el = document.querySelector('dynamic-micro-counter');
        const items = el?.shadowRoot?.querySelectorAll('li');
        return Array.from(items || []).map((li: any) => li.textContent);
      });
      expect(listItems).toEqual(['Alpha', 'Beta']);

      // Mutate count to trigger batched microtask update
      await page.evaluate(() => {
        const el = document.querySelector('dynamic-micro-counter') as any;
        if (el) {
          el.count = 42;
        }
      });

      // Wait microtask
      await page.evaluate(() => new Promise((r) => queueMicrotask(() => r(null))));

      const renderedCount = await page.evaluate(() => {
        const el = document.querySelector('dynamic-micro-counter');
        return el?.shadowRoot?.querySelector('#count')?.textContent;
      });

      expect(renderedCount).toBe('42');
    });
  });
});
