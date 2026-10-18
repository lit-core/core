import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buttonStyles, CdsButton, CdsCheckbox, CdsTab, CdsTabs, checkboxStyles, tabsStyles } from '@lit-core/morph-to-react/carbon';
import React, { StrictMode } from 'react';
import { renderToString } from 'react-dom/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bundleComponentForBrowser } from '../bundler.js';
import { getTestBrowser } from '../harness.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Milestone 0 Challenger 2 (Verification Wave 1: Oracle Parity & Visual Match)', () => {
  let browser: any;
  let page: any;

  beforeAll(async () => {
    browser = await getTestBrowser();
    page = await browser.newPage();
    await page.setContent(`
      <!DOCTYPE html>
      <html>
        <head><meta charset="utf-8"></head>
        <body>
          <div id="test-root"></div>
          <iframe id="frame-a" style="width: 800px; height: 600px; border: none;"></iframe>
          <iframe id="frame-b" style="width: 800px; height: 600px; border: none;"></iframe>
        </body>
      </html>
    `);

    // Bundle authentic @carbon/web-components for Frame A
    const carbonBundleCode = await bundleComponentForBrowser({
      imports: [
        "import '@carbon/web-components/es/components/button/index.js';",
        "import '@carbon/web-components/es/components/checkbox/index.js';",
        "import '@carbon/web-components/es/components/tabs/index.js';",
      ],
    });

    // Initialize Frame A with bundled Web Components
    await page.evaluate(
      ({ bundleCode, styles }: { bundleCode: string; styles: string }) => {
        const fA = document.getElementById('frame-a') as HTMLIFrameElement;
        const docA = fA?.contentDocument;
        if (!docA) return;

        docA.open();
        docA.write(`
          <!DOCTYPE html>
          <html>
            <head>
              <meta charset="utf-8">
              <style>
                body { margin: 0; padding: 16px; background: #ffffff; font-family: sans-serif; }
                ${styles}
              </style>
              <script type="module">
                ${bundleCode}
                window.__wcReady = true;
              </script>
            </head>
            <body>
              <div id="wc-root"></div>
            </body>
          </html>
        `);
        docA.close();

        // Initialize Frame B container
        const fB = document.getElementById('frame-b') as HTMLIFrameElement;
        const docB = fB?.contentDocument;
        if (!docB) return;
        docB.open();
        docB.write('<!DOCTYPE html><html><head><meta charset="utf-8"></head><body><div id="react-root"></div></body></html>');
        docB.close();
      },
      { bundleCode: carbonBundleCode, styles: buttonStyles },
    );

    // Wait for custom elements registration in Frame A
    await page.waitForFunction(
      () => {
        const fA = document.getElementById('frame-a') as HTMLIFrameElement;
        const winA = fA?.contentWindow as any;
        return winA?.__wcReady && winA?.customElements?.get('cds-button') && winA?.customElements?.get('cds-checkbox') && winA?.customElements?.get('cds-tabs') && winA?.customElements?.get('cds-tab');
      },
      null,
      { timeout: 15000 },
    );
  });

  afterAll(async () => {
    if (page) {
      await page.close();
    }
  });

  async function mountFrameA(html: string): Promise<void> {
    await page.evaluate(async (wcHtml: string) => {
      const fA = document.getElementById('frame-a') as HTMLIFrameElement;
      const rootA = fA.contentDocument?.getElementById('wc-root');
      if (!rootA) throw new Error('Frame A wc-root missing');

      rootA.innerHTML = wcHtml;

      const customElements = rootA.querySelectorAll('*');
      for (const el of Array.from(customElements)) {
        if (el.tagName.toLowerCase().startsWith('cds-') && 'updateComplete' in el) {
          await (el as any).updateComplete;
        }
      }
    }, html);
  }

  async function mountFrameB(reactHtml: string, styles: string): Promise<void> {
    await page.evaluate(
      ({ html, css }: { html: string; css: string }) => {
        const fB = document.getElementById('frame-b') as HTMLIFrameElement;
        const docB = fB.contentDocument;
        if (!docB) throw new Error('Frame B document missing');

        docB.open();
        docB.write(`
          <!DOCTYPE html>
          <html>
            <head>
              <meta charset="utf-8">
              <style>
                body { margin: 0; padding: 16px; background: #ffffff; font-family: sans-serif; }
                ${css}
              </style>
            </head>
            <body>
              <div id="react-root">${html}</div>
            </body>
          </html>
        `);
        docB.close();

        // Capture-phase click suppression for disabled cds-button
        const buttons = docB.querySelectorAll('cds-button');
        for (const btn of Array.from(buttons)) {
          btn.addEventListener(
            'click',
            (e: Event) => {
              if (btn.hasAttribute('disabled')) {
                e.preventDefault();
                e.stopPropagation();
              }
            },
            { capture: true },
          );
        }
      },
      { html: reactHtml, css: styles },
    );
  }

  // =========================================================================
  // SECTION 1: AUTHENTIC SHADOW DOM ATTACHMENT IN FRAME A VS LIGHT DOM IN FRAME B
  // =========================================================================
  describe('authentic Shadow DOM attachment verification', () => {
    it('proves Frame A attaches genuine open Shadow DOM across all components', async () => {
      await mountFrameA(`
        <cds-button kind="primary">Btn</cds-button>
        <cds-checkbox checked>Chk</cds-checkbox>
        <cds-tabs value="t1">
          <cds-tab value="t1">Tab 1</cds-tab>
        </cds-tabs>
      `);

      const shadowDomCheck = await page.evaluate(() => {
        const fA = document.getElementById('frame-a') as HTMLIFrameElement;
        const docA = fA.contentDocument;
        if (!docA) throw new Error('Frame A doc missing');

        const btn = docA.querySelector('cds-button') as any;
        const chk = docA.querySelector('cds-checkbox') as any;
        const tabs = docA.querySelector('cds-tabs') as any;
        const tab = docA.querySelector('cds-tab') as any;

        return {
          btnHasShadow: Boolean(btn?.shadowRoot),
          btnShadowMode: btn?.shadowRoot?.mode,
          btnInnerButton: Boolean(btn?.shadowRoot?.querySelector('button')),
          chkHasShadow: Boolean(chk?.shadowRoot),
          chkShadowMode: chk?.shadowRoot?.mode,
          chkInnerInput: Boolean(chk?.shadowRoot?.querySelector('input')),
          tabsHasShadow: Boolean(tabs?.shadowRoot),
          tabsShadowMode: tabs?.shadowRoot?.mode,
          tabHasShadow: Boolean(tab?.shadowRoot),
          tabShadowMode: tab?.shadowRoot?.mode,
          // Custom element constructors are registered and valid
          isCdsButtonRegistered: Boolean(fA.contentWindow?.customElements.get('cds-button')),
          isCdsCheckboxRegistered: Boolean(fA.contentWindow?.customElements.get('cds-checkbox')),
          isCdsTabsRegistered: Boolean(fA.contentWindow?.customElements.get('cds-tabs')),
        };
      });

      expect(shadowDomCheck.isCdsButtonRegistered).toBe(true);
      expect(shadowDomCheck.isCdsCheckboxRegistered).toBe(true);
      expect(shadowDomCheck.isCdsTabsRegistered).toBe(true);

      expect(shadowDomCheck.btnHasShadow).toBe(true);
      expect(shadowDomCheck.btnShadowMode).toBe('open');
      expect(shadowDomCheck.btnInnerButton).toBe(true);

      expect(shadowDomCheck.chkHasShadow).toBe(true);
      expect(shadowDomCheck.chkShadowMode).toBe('open');
      expect(shadowDomCheck.chkInnerInput).toBe(true);

      expect(shadowDomCheck.tabsHasShadow).toBe(true);
      expect(shadowDomCheck.tabsShadowMode).toBe('open');

      expect(shadowDomCheck.tabHasShadow).toBe(true);
      expect(shadowDomCheck.tabShadowMode).toBe('open');
    });

    it('proves Frame B renders components in Light DOM with null shadowRoot', async () => {
      const btnHtml = renderToString(React.createElement(StrictMode, null, React.createElement(CdsButton, { kind: 'primary' }, 'Btn')));
      const chkHtml = renderToString(React.createElement(StrictMode, null, React.createElement(CdsCheckbox, { checked: true, labelText: 'Chk' })));
      const tabsHtml = renderToString(React.createElement(StrictMode, null, React.createElement(CdsTabs, { value: 't1' }, React.createElement(CdsTab, { value: 't1' }, 'Tab 1'))));

      await mountFrameB(`${btnHtml}${chkHtml}${tabsHtml}`, `${buttonStyles}\n${checkboxStyles}\n${tabsStyles}`);

      const lightDomCheck = await page.evaluate(() => {
        const fB = document.getElementById('frame-b') as HTMLIFrameElement;
        const docB = fB.contentDocument;
        if (!docB) throw new Error('Frame B doc missing');

        const btn = docB.querySelector('cds-button');
        const chk = docB.querySelector('cds-checkbox');
        const tabs = docB.querySelector('cds-tabs');

        return {
          btnShadowRoot: btn?.shadowRoot,
          chkShadowRoot: chk?.shadowRoot,
          tabsShadowRoot: tabs?.shadowRoot,
          // Inner elements exist directly in light DOM child tree
          btnInnerButtonInLightDom: Boolean(btn?.querySelector('button')),
          chkInnerInputInLightDom: Boolean(chk?.querySelector('input')),
        };
      });

      expect(lightDomCheck.btnShadowRoot).toBeNull();
      expect(lightDomCheck.chkShadowRoot).toBeNull();
      expect(lightDomCheck.tabsShadowRoot).toBeNull();
      expect(lightDomCheck.btnInnerButtonInLightDom).toBe(true);
      expect(lightDomCheck.chkInnerInputInLightDom).toBe(true);
    });
  });

  // =========================================================================
  // SECTION 2: ACCESSIBILITY SNAPSHOT PARITY (100% MATCH)
  // =========================================================================
  describe('accessibility snapshot parity (100% match)', () => {
    it('matches 100% ariaSnapshot on button variants (primary, secondary, danger, ghost, disabled)', async () => {
      const buttonVariants = [
        { kind: 'primary', label: 'Primary Action', disabled: false },
        { kind: 'secondary', label: 'Secondary Action', disabled: false },
        { kind: 'danger', label: 'Danger Action', disabled: false },
        { kind: 'ghost', label: 'Ghost Action', disabled: false },
        { kind: 'primary', label: 'Disabled Primary', disabled: true },
      ];

      for (const variant of buttonVariants) {
        const reactHtml = renderToString(React.createElement(StrictMode, null, React.createElement(CdsButton, { kind: variant.kind as any, disabled: variant.disabled }, variant.label)));

        await mountFrameA(`<cds-button kind="${variant.kind}" ${variant.disabled ? 'disabled' : ''}>${variant.label}</cds-button>`);
        await mountFrameB(reactHtml, buttonStyles);

        const wcAria = await page.frameLocator('#frame-a').locator('cds-button').ariaSnapshot();
        const reactAria = await page.frameLocator('#frame-b').locator('cds-button').ariaSnapshot();

        expect(reactAria).toBe(wcAria);
        expect(reactAria).toContain(variant.label);
      }
    });

    it('matches 100% ariaSnapshot on checkbox variants (unchecked, checked, disabled)', async () => {
      const checkboxVariants = [
        { checked: false, disabled: false, label: 'Unchecked Agreement' },
        { checked: true, disabled: false, label: 'Checked Agreement' },
        { checked: false, disabled: true, label: 'Disabled Agreement' },
        { checked: true, disabled: true, label: 'Checked and Disabled' },
      ];

      for (const variant of checkboxVariants) {
        const reactHtml = renderToString(React.createElement(StrictMode, null, React.createElement(CdsCheckbox, { checked: variant.checked, disabled: variant.disabled, labelText: variant.label })));

        await mountFrameA(`<cds-checkbox ${variant.checked ? 'checked' : ''} ${variant.disabled ? 'disabled' : ''}>${variant.label}</cds-checkbox>`);
        await mountFrameB(reactHtml, checkboxStyles);

        const wcAria = await page.frameLocator('#frame-a').locator('cds-checkbox').ariaSnapshot();
        const reactAria = await page.frameLocator('#frame-b').locator('cds-checkbox').ariaSnapshot();

        expect(reactAria).toBe(wcAria);
        expect(reactAria).toContain(variant.label);
      }
    });

    it('matches 100% ariaSnapshot on tabs composite', async () => {
      const reactTabsHtml = renderToString(
        React.createElement(
          StrictMode,
          null,
          React.createElement(
            CdsTabs,
            { value: 'tab-1' },
            React.createElement(CdsTab, { value: 'tab-1', target: 'panel-1' }, 'Dashboard'),
            React.createElement(CdsTab, { value: 'tab-2', target: 'panel-2' }, 'Analytics'),
            React.createElement(CdsTab, { value: 'tab-3', target: 'panel-3', disabled: true }, 'Restricted'),
          ),
        ),
      );

      await mountFrameA(`
        <cds-tabs value="tab-1">
          <cds-tab value="tab-1" target="panel-1">Dashboard</cds-tab>
          <cds-tab value="tab-2" target="panel-2">Analytics</cds-tab>
          <cds-tab value="tab-3" target="panel-3" disabled>Restricted</cds-tab>
        </cds-tabs>
      `);
      await mountFrameB(reactTabsHtml, tabsStyles);

      const wcAria = await page.frameLocator('#frame-a').locator('cds-tabs').ariaSnapshot();
      const reactAria = await page.frameLocator('#frame-b').locator('cds-tabs').ariaSnapshot();

      expect(reactAria).toBe(wcAria);
      expect(reactAria).toContain('Dashboard');
      expect(reactAria).toContain('Analytics');
      expect(reactAria).toContain('Restricted');
    });
  });

  // =========================================================================
  // SECTION 3: VISUAL PIXEL PARITY (>= 99.5% MATCH)
  // =========================================================================
  describe('visual screenshot pixel parity (>= 99.5% match)', () => {
    async function compareScreenshots(selector: string): Promise<number> {
      const locA = page.frameLocator('#frame-a').locator(selector);
      const locB = page.frameLocator('#frame-b').locator(selector);

      // Defocus any active elements
      await page.evaluate(() => {
        const fA = document.getElementById('frame-a') as HTMLIFrameElement;
        const fB = document.getElementById('frame-b') as HTMLIFrameElement;
        (fA.contentDocument?.activeElement as HTMLElement)?.blur();
        (fB.contentDocument?.activeElement as HTMLElement)?.blur();
      });

      const pngA = await locA.screenshot();
      const pngB = await locB.screenshot();

      return await page.evaluate(
        async ({ b64A, b64B }: { b64A: string; b64B: string }) => {
          const load = (src: string) =>
            new Promise<HTMLImageElement>((resolve) => {
              const img = new Image();
              img.onload = () => resolve(img);
              img.src = src;
            });

          const [imgA, imgB] = await Promise.all([load(b64A), load(b64B)]);
          const w = Math.min(imgA.width, imgB.width);
          const h = Math.min(imgA.height, imgB.height);

          const cA = document.createElement('canvas');
          cA.width = w;
          cA.height = h;
          const ctxA = cA.getContext('2d');
          if (!ctxA) throw new Error('Canvas 2D context A failed');
          ctxA.drawImage(imgA, 0, 0);
          const dataA = ctxA.getImageData(0, 0, w, h).data;

          const cB = document.createElement('canvas');
          cB.width = w;
          cB.height = h;
          const ctxB = cB.getContext('2d');
          if (!ctxB) throw new Error('Canvas 2D context B failed');
          ctxB.drawImage(imgB, 0, 0);
          const dataB = ctxB.getImageData(0, 0, w, h).data;

          let diffCount = 0;
          const totalPixels = w * h;
          for (let i = 0; i < dataA.length; i += 4) {
            const rDiff = Math.abs(dataA[i] - dataB[i]);
            const gDiff = Math.abs(dataA[i + 1] - dataB[i + 1]);
            const bDiff = Math.abs(dataA[i + 2] - dataB[i + 2]);
            if (rDiff > 10 || gDiff > 10 || bDiff > 10) {
              diffCount++;
            }
          }
          return (1 - diffCount / totalPixels) * 100;
        },
        {
          b64A: `data:image/png;base64,${pngA.toString('base64')}`,
          b64B: `data:image/png;base64,${pngB.toString('base64')}`,
        },
      );
    }

    it('measures >= 99.5% visual match on Primary button', async () => {
      const reactHtml = renderToString(React.createElement(StrictMode, null, React.createElement(CdsButton, { kind: 'primary' }, 'Primary Action')));
      await mountFrameA('<cds-button kind="primary">Primary Action</cds-button>');
      await mountFrameB(reactHtml, buttonStyles);

      const score = await compareScreenshots('cds-button');
      console.log(`Primary button visual score: ${score.toFixed(3)}%`);
      expect(score).toBeGreaterThanOrEqual(99.5);
    });

    it('measures >= 99.5% visual match on Danger button', async () => {
      const reactHtml = renderToString(React.createElement(StrictMode, null, React.createElement(CdsButton, { kind: 'danger' }, 'Delete Item')));
      await mountFrameA('<cds-button kind="danger">Delete Item</cds-button>');
      await mountFrameB(reactHtml, buttonStyles);

      const score = await compareScreenshots('cds-button');
      console.log(`Danger button visual score: ${score.toFixed(3)}%`);
      expect(score).toBeGreaterThanOrEqual(99.5);
    });

    it('measures >= 99.5% visual match on Secondary button', async () => {
      const reactHtml = renderToString(React.createElement(StrictMode, null, React.createElement(CdsButton, { kind: 'secondary' }, 'Secondary Option')));
      await mountFrameA('<cds-button kind="secondary">Secondary Option</cds-button>');
      await mountFrameB(reactHtml, buttonStyles);

      const score = await compareScreenshots('cds-button');
      console.log(`Secondary button visual score: ${score.toFixed(3)}%`);
      expect(score).toBeGreaterThanOrEqual(99.5);
    });

    it('measures >= 99.5% visual match on Ghost button', async () => {
      const reactHtml = renderToString(React.createElement(StrictMode, null, React.createElement(CdsButton, { kind: 'ghost' }, 'Ghost Link')));
      await mountFrameA('<cds-button kind="ghost">Ghost Link</cds-button>');
      await mountFrameB(reactHtml, buttonStyles);

      const score = await compareScreenshots('cds-button');
      console.log(`Ghost button visual score: ${score.toFixed(3)}%`);
      expect(score).toBeGreaterThanOrEqual(99.5);
    });

    it('measures >= 99.5% visual match on Checkbox (checked state)', async () => {
      const reactHtml = renderToString(React.createElement(StrictMode, null, React.createElement(CdsCheckbox, { checked: true, labelText: 'Verified Parity' })));
      await mountFrameA('<cds-checkbox checked>Verified Parity</cds-checkbox>');
      await mountFrameB(reactHtml, checkboxStyles);

      const score = await compareScreenshots('cds-checkbox');
      console.log(`Checkbox checked visual score: ${score.toFixed(3)}%`);
      expect(score).toBeGreaterThanOrEqual(99.5);
    });

    it('measures >= 99.5% visual match on Checkbox (unchecked state)', async () => {
      const reactHtml = renderToString(React.createElement(StrictMode, null, React.createElement(CdsCheckbox, { checked: false, labelText: 'Unchecked Parity' })));
      await mountFrameA('<cds-checkbox>Unchecked Parity</cds-checkbox>');
      await mountFrameB(reactHtml, checkboxStyles);

      const score = await compareScreenshots('cds-checkbox');
      console.log(`Checkbox unchecked visual score: ${score.toFixed(3)}%`);
      expect(score).toBeGreaterThanOrEqual(99.5);
    });

    it('measures >= 99.5% visual match on Tabs composite', async () => {
      const reactTabsHtml = renderToString(
        React.createElement(
          StrictMode,
          null,
          React.createElement(
            CdsTabs,
            { value: 'tab-1' },
            React.createElement(CdsTab, { value: 'tab-1' }, 'Overview'),
            React.createElement(CdsTab, { value: 'tab-2' }, 'Settings'),
            React.createElement(CdsTab, { value: 'tab-3', disabled: true }, 'Disabled Tab'),
          ),
        ),
      );

      await mountFrameA(`
        <cds-tabs value="tab-1">
          <cds-tab value="tab-1">Overview</cds-tab>
          <cds-tab value="tab-2">Settings</cds-tab>
          <cds-tab value="tab-3" disabled>Disabled Tab</cds-tab>
        </cds-tabs>
      `);
      await mountFrameB(reactTabsHtml, tabsStyles);

      const score = await compareScreenshots('cds-tabs');
      console.log(`Tabs composite visual score: ${score.toFixed(3)}%`);
      expect(score).toBeGreaterThanOrEqual(99.5);
    });
  });

  // =========================================================================
  // SECTION 4: HOSTILE STYLESHEET RESISTANCE IN FRAME A VS PENETRATION IN FRAME B
  // =========================================================================
  describe('hostile global stylesheet differential isolation gap', () => {
    it('proves authentic Shadow DOM resistance in Frame A while measuring light DOM penetration in Frame B', async () => {
      await mountFrameA('<cds-button kind="primary">Web Component Shadow DOM</cds-button>');
      await mountFrameB(renderToString(React.createElement(StrictMode, null, React.createElement(CdsButton, { kind: 'primary' }, 'React Component Light DOM'))), buttonStyles);

      const hostileGap = await page.evaluate(async () => {
        const fA = document.getElementById('frame-a') as HTMLIFrameElement;
        const fB = document.getElementById('frame-b') as HTMLIFrameElement;
        const docA = fA.contentDocument;
        const docB = fB.contentDocument;
        if (!docA || !docB) throw new Error('Frame docs missing');

        // Aggressive global hostile stylesheet
        const hostileCss = `
          * { box-sizing: content-box !important; }
          button {
            margin: 28px !important;
            padding: 16px !important;
            border: 4px solid magenta !important;
          }
        `;

        const styleElA = docA.createElement('style');
        styleElA.id = 'hostile-probe-a';
        styleElA.textContent = hostileCss;
        docA.head.appendChild(styleElA);

        const styleElB = docB.createElement('style');
        styleElB.id = 'hostile-probe-b';
        styleElB.textContent = hostileCss;
        docB.head.appendChild(styleElB);

        const cdsBtnA = docA.querySelector('cds-button') as any;
        if (cdsBtnA && 'updateComplete' in cdsBtnA) {
          await cdsBtnA.updateComplete;
        }

        const innerBtnA = cdsBtnA?.shadowRoot?.querySelector('button');
        const innerBtnB = docB.querySelector('button');

        const marginA = innerBtnA ? fA.contentWindow?.getComputedStyle(innerBtnA).margin : '0px';
        const marginB = innerBtnB ? fB.contentWindow?.getComputedStyle(innerBtnB).margin : '0px';

        const borderA = innerBtnA ? fA.contentWindow?.getComputedStyle(innerBtnA).borderTopWidth : '0px';
        const borderB = innerBtnB ? fB.contentWindow?.getComputedStyle(innerBtnB).borderTopWidth : '0px';

        // Cleanup hostile styles
        styleElA.remove();
        styleElB.remove();

        return {
          marginA,
          marginB,
          borderA,
          borderB,
          shadowDomResisted: marginA === '0px' && borderA !== '4px',
          lightDomPenetrated: marginB === '28px' && borderB === '4px',
        };
      });

      console.log('Hostile isolation gap measurement:', hostileGap);
      expect(hostileGap.shadowDomResisted).toBe(true);
      expect(hostileGap.marginA).toBe('0px');
      expect(hostileGap.lightDomPenetrated).toBe(true);
      expect(hostileGap.marginB).toBe('28px');
      expect(hostileGap.borderB).toBe('4px');
    });
  });
});
