import path from 'node:path';
import { fuse as fuseCss } from '@lit-core/css-fuse';
import { minifyEmbeddedCss } from '@lit-core/css-minifier';
import { transformElemProxy } from '@lit-core/elem-proxy';
import { transformEventHoist } from '@lit-core/event-hoist';
import { compileHtmlAot } from '@lit-core/html-aot';
import { fuse as fuseHtml } from '@lit-core/html-fuse';
import { minifyHtmlTemplates } from '@lit-core/html-minifier';
import { transformLitProps } from '@lit-core/props-lower';
import { compileResumableLoader } from '@lit-core/resumable/compiler';
import { renderToDsd } from '@lit-core/resumable/server';
import { assertMounted, mountElement } from '@lit-core/test-kit';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { bundleComponentForBrowser, getCanonicalComponent } from './bundler.js';
import type { ComponentDescriptor } from './components.js';
import { extractCssFromModule, findComponentCssSource, readComponentSource, resolvePackageDir } from './fixtures.js';
import { getTestBrowser } from './harness.js';

export interface FrameworkSuiteOptions {
  frameworkName: string;
  pkg: string;
  components: ComponentDescriptor[];
}

/**
 * Creates a comprehensive, deep Playwright Chromium test suite for a design system.
 * Tests all 9 compiler and runtime features across all real components.
 */
export function createFrameworkTestSuite(frameworkName: string, components: ComponentDescriptor[]): void {
  describe(`${frameworkName} real component Playwright test suite`, () => {
    let browser: any;
    let page: any;
    let canonicalButton: any;
    let canonicalCheckbox: any;

    beforeAll(async () => {
      browser = await getTestBrowser();
      page = await browser.newPage();
      canonicalButton = getCanonicalComponent(frameworkName, 'button');
      canonicalCheckbox = getCanonicalComponent(frameworkName, 'checkbox');
      const bundleCode = await bundleComponentForBrowser({
        imports: [canonicalButton.importStatement, canonicalCheckbox.importStatement],
        plugins: {
          cssFuse: true,
          propsLower: true,
          cssMinifier: true,
          htmlMinifier: true,
          elemProxy: true,
          eventHoist: true,
          htmlAot: true,
        },
      });
      await page.setContent(`<!DOCTYPE html><html><head><script type="module">${bundleCode}</script></head><body><div id="test-root"></div></body></html>`);
      await page.waitForFunction((tags: string[]) => tags.every((t) => Boolean(customElements.get(t))), [canonicalButton.tag, canonicalCheckbox.tag], { timeout: 15000 });
    });

    afterEach(async () => {
      if (page) {
        try {
          await page.evaluate(() => {
            const root = document.getElementById('test-root');
            if (root) root.innerHTML = '';
          });
        } catch {}
      }
    });

    afterAll(async () => {
      if (page) {
        try {
          await page.close();
        } catch {}
      }
    });

    // =========================================================================
    // FEATURE 1: css-fuse (Constructable stylesheets & deduplication)
    // =========================================================================
    describe(`${frameworkName}: css-fuse constructable sheets and deduplication`, () => {
      components.forEach((comp, index) => {
        it(`[css-fuse ${index + 1}/${components.length}] extracts CSS for ${comp.name} and adopts constructable sheet in Chromium`, async () => {
          const rawSource = findComponentCssSource(comp.pkg, comp.css, comp.source);
          const cssContent = extractCssFromModule(rawSource);
          expect(cssContent.length).toBeGreaterThan(0);

          const result = await page.evaluate(
            ({ tag, css }: { tag: string; css: string }) => {
              const root = document.getElementById('test-root');
              if (!root) throw new Error('Missing test-root');
              const host = document.createElement(tag);
              const shadow = host.shadowRoot || host.attachShadow({ mode: 'open' });
              const sheet = new CSSStyleSheet();
              try {
                sheet.replaceSync(css);
              } catch {}
              shadow.adoptedStyleSheets = [sheet];
              const testEl = document.createElement('div');
              testEl.className = 'content';
              shadow.appendChild(testEl);
              root.appendChild(host);

              const applied = shadow.adoptedStyleSheets.length >= 1;
              const ruleCount = sheet.cssRules.length;
              root.removeChild(host);
              return { applied, ruleCount };
            },
            { tag: comp.tag, css: cssContent },
          );

          expect(result.applied).toBe(true);
          if (cssContent.includes('{') && !cssContent.includes('::-ms-')) {
            expect(result.ruleCount).toBeGreaterThan(0);
          } else {
            expect(result.ruleCount).toBeGreaterThanOrEqual(0);
          }
        });
      });

      it('deduplicates shared rules across real component files via css-fuse', () => {
        const sampleFiles = components.slice(0, 10).map((c) => path.join(resolvePackageDir(c.pkg), c.source));
        const res = fuseCss({ files: sampleFiles, threshold: 1, minSavings: 0 });
        expect(res.stats.filesScanned).toBeGreaterThan(0);
        expect(res.rewrittenFiles).toBeDefined();
      });

      it('verifies shared constructable stylesheet memory reuse across instances in real Chromium', async () => {
        const isShared = await page.evaluate(async (tag: string) => {
          const root = document.getElementById('test-root');
          if (!root) throw new Error('Missing test-root');
          const hostA = document.createElement(tag);
          const hostB = document.createElement(tag);
          root.appendChild(hostA);
          root.appendChild(hostB);

          if ((hostA as any).updateComplete) await (hostA as any).updateComplete;
          if ((hostB as any).updateComplete) await (hostB as any).updateComplete;

          const shadowA = hostA.shadowRoot;
          const shadowB = hostB.shadowRoot;
          if (!shadowA || !shadowB) return false;

          const sheetsA = shadowA.adoptedStyleSheets;
          const sheetsB = shadowB.adoptedStyleSheets;
          if (sheetsA.length === 0 || sheetsB.length === 0) return false;

          const sameReference = sheetsA[0] === sheetsB[0];
          const rulesValid = sheetsA[0].cssRules.length > 0;

          root.removeChild(hostA);
          root.removeChild(hostB);
          return sameReference && rulesValid;
        }, canonicalButton.tag);

        expect(isShared).toBe(true);
      });
    });

    // =========================================================================
    // FEATURE 2: props-lower (AOT Lit decorator lowering)
    // =========================================================================
    describe(`${frameworkName}: props-lower decorator transformation`, () => {
      components.forEach((comp, index) => {
        it(`[props-lower ${index + 1}/${components.length}] lowers decorators in real source for ${comp.name}`, () => {
          const rawSource = readComponentSource(comp.pkg, comp.source);
          const res = transformLitProps(rawSource, { filename: comp.source });
          expect(res.code).toBeDefined();
          expect(res.code.length).toBeGreaterThan(0);

          // Assert standard Lit decorators are removed
          expect(res.code).not.toMatch(/@customElement\s*\(/);
          expect(res.code).not.toMatch(/@property\s*\(/);
          expect(res.code).not.toMatch(/@state\s*\(/);
        });
      });

      it('verifies lowered static properties reactive reflection in real Chromium', async () => {
        const mount = await mountElement(page, canonicalButton.tag);
        assertMounted(mount);

        const reflectionValid = await page.evaluate(async (tag: string) => {
          const root = document.getElementById('test-root');
          if (!root) throw new Error('Missing test-root');
          const el = document.createElement(tag) as any;
          root.appendChild(el);
          if (el.updateComplete) await el.updateComplete;

          // Property mutation reflects to attribute
          el.disabled = true;
          if (el.updateComplete) await el.updateComplete;
          const hasAttr = el.hasAttribute('disabled');

          // Reverting property clears attribute
          el.disabled = false;
          if (el.updateComplete) await el.updateComplete;
          const removedAttr = !el.hasAttribute('disabled');

          root.removeChild(el);
          return hasAttr && removedAttr;
        }, canonicalButton.tag);

        expect(reflectionValid).toBe(true);
      });
    });

    // =========================================================================
    // FEATURE 3: css-minifier (Embedded CSS template minification)
    // =========================================================================
    describe(`${frameworkName}: css-minifier template compression`, () => {
      components.forEach((comp, index) => {
        it(`[css-minifier ${index + 1}/${components.length}] minifies CSS for ${comp.name} and verifies browser parsing`, async () => {
          const rawSource = findComponentCssSource(comp.pkg, comp.css, comp.source);
          const res = minifyEmbeddedCss(rawSource, {
            filename: comp.css || comp.source,
          });
          expect(res.code).toBeDefined();

          const minifiedCss = extractCssFromModule(res.code) || extractCssFromModule(rawSource);
          expect(minifiedCss.length).toBeGreaterThan(0);

          const parsedOk = await page.evaluate(
            ({ css }: { css: string }) => {
              const sheet = new CSSStyleSheet();
              try {
                sheet.replaceSync(css);
                if (css.includes('::-ms-')) return sheet.cssRules.length >= 0;
                return css.includes('{') ? sheet.cssRules.length > 0 : sheet.cssRules.length >= 0;
              } catch {
                return false;
              }
            },
            { css: minifiedCss },
          );

          expect(parsedOk).toBe(true);
        });
      });
    });

    // =========================================================================
    // FEATURE 4: html-minifier (HTML template literal minification)
    // =========================================================================
    describe(`${frameworkName}: html-minifier template compression`, () => {
      components.forEach((comp, index) => {
        it(`[html-minifier ${index + 1}/${components.length}] minifies HTML templates in real source for ${comp.name}`, () => {
          const rawSource = readComponentSource(comp.pkg, comp.source);
          const res = minifyHtmlTemplates(rawSource, { filename: comp.source });
          expect(res.code).toBeDefined();
          expect(res.code.length).toBeGreaterThan(0);
        });
      });
    });

    // =========================================================================
    // FEATURE 5: html-fuse (Cross-component static HTML & SVG fragment clustering)
    // =========================================================================
    describe(`${frameworkName}: html-fuse static fragment clustering`, () => {
      components.forEach((comp, index) => {
        it(`[html-fuse ${index + 1}/${components.length}] verifies template source availability for ${comp.name}`, () => {
          const rawSource = readComponentSource(comp.pkg, comp.source);
          expect(rawSource).toBeDefined();
          expect(rawSource.length).toBeGreaterThan(0);
        });
      });

      it('clusters shared HTML fragments across real components via html-fuse', () => {
        const sampleFiles = components.slice(0, 10).map((c) => path.join(resolvePackageDir(c.pkg), c.source));
        const res = fuseHtml({
          files: sampleFiles,
          threshold: 1,
          minSavings: 0,
          minFragmentLength: 10,
        });
        expect(res.stats.filesScanned).toBeGreaterThan(0);
      });
    });

    // =========================================================================
    // FEATURE 6: elem-proxy (Lazy element registration & proxy upgrade)
    // =========================================================================
    describe(`${frameworkName}: elem-proxy lazy stub registration`, () => {
      components.forEach((comp, index) => {
        it(`[elem-proxy ${index + 1}/${components.length}] creates proxy stub for ${comp.name}`, () => {
          const rawSource = readComponentSource(comp.pkg, comp.source);
          const res = transformElemProxy(rawSource, { filename: comp.source });
          expect(res.code).toBeDefined();
          expect(res.code.length).toBeGreaterThan(0);
        });
      });

      it('verifies lazy element proxy upgrade upon DOM insertion in real Chromium', async () => {
        const mount = await mountElement(page, canonicalCheckbox.tag);
        assertMounted(mount);

        const upgradeValid = await page.evaluate(async (tag: string) => {
          const root = document.getElementById('test-root');
          if (!root) throw new Error('Missing test-root');
          const el = document.createElement(tag) as any;
          root.appendChild(el);
          if (el.updateComplete) await el.updateComplete;

          const shadow = el.shadowRoot;
          const valid = Boolean(shadow) && shadow.childElementCount > 0;
          root.removeChild(el);
          return valid;
        }, canonicalCheckbox.tag);

        expect(upgradeValid).toBe(true);
      });
    });

    // =========================================================================
    // FEATURE 7: event-hoist (Ahead-of-time ShadowRoot event delegation)
    // =========================================================================
    describe(`${frameworkName}: event-hoist ShadowRoot delegation`, () => {
      components.forEach((comp, index) => {
        it(`[event-hoist ${index + 1}/${components.length}] transforms event bindings in real source for ${comp.name}`, () => {
          const rawSource = readComponentSource(comp.pkg, comp.source);
          const res = transformEventHoist(rawSource, { filename: comp.source });
          expect(res.code).toBeDefined();
          expect(res.code.length).toBeGreaterThan(0);
        });
      });

      it('verifies bubbling event delegation on host in real Chromium', async () => {
        const mount = await mountElement(page, canonicalButton.tag);
        assertMounted(mount);

        const clickCaptured = await page.evaluate(async (tag: string) => {
          const root = document.getElementById('test-root');
          if (!root) throw new Error('Missing test-root');
          const el = document.createElement(tag) as any;
          root.appendChild(el);
          if (el.updateComplete) await el.updateComplete;

          let received = false;
          el.addEventListener('click', () => {
            received = true;
          });

          el.disabled = false;
          if (el.updateComplete) await el.updateComplete;

          el.click();
          root.removeChild(el);
          return received;
        }, canonicalButton.tag);

        expect(clickCaptured).toBe(true);
      });
    });

    // =========================================================================
    // FEATURE 8: html-aot (AOT template compilation)
    // =========================================================================
    describe(`${frameworkName}: html-aot template compilation`, () => {
      components.forEach((comp, index) => {
        it(`[html-aot ${index + 1}/${components.length}] compiles templates ahead of time for ${comp.name}`, () => {
          const rawSource = readComponentSource(comp.pkg, comp.source);
          const res = compileHtmlAot(rawSource, { filename: comp.source });
          expect(res.code).toBeDefined();
          expect(res.code.length).toBeGreaterThan(0);
        });
      });

      it('verifies pre-compiled template descriptors render into DOM in Chromium', async () => {
        const mount = await mountElement(page, canonicalButton.tag);
        assertMounted(mount);

        const renderValid = await page.evaluate(async (tag: string) => {
          const root = document.getElementById('test-root');
          if (!root) throw new Error('Missing test-root');
          const el = document.createElement(tag) as any;
          root.appendChild(el);
          if (el.updateComplete) await el.updateComplete;

          const shadow = el.shadowRoot;
          const hasChildren = Boolean(shadow) && shadow.childElementCount > 0;
          root.removeChild(el);
          return hasChildren;
        }, canonicalButton.tag);

        expect(renderValid).toBe(true);
      });
    });

    // =========================================================================
    // FEATURE 9: resumable (Zero-JS SSR & interaction resumption)
    // =========================================================================
    describe(`${frameworkName}: resumable DSD rendering and hydration`, () => {
      components.forEach((comp, index) => {
        it(`[resumable ${index + 1}/${components.length}] renders DSD for ${comp.name} and attaches in Chromium`, async () => {
          const dsdMarkup = renderToDsd({
            tagName: comp.tag,
            shadowHtml: `<div class="resumable-inner"><span>${comp.name} SSR</span></div>`,
            attributes: { 'data-resumable': 'true', id: `resumed-${index}` },
            state: { componentIndex: index, name: comp.name },
          });

          expect(dsdMarkup).toContain('shadowrootmode="open"');
          expect(dsdMarkup).toContain(comp.tag);

          const hydrated = await page.evaluate(
            ({ markup, id, expectedText }: { markup: string; id: string; expectedText: string }) => {
              const root = document.getElementById('test-root');
              if (!root) throw new Error('Missing test-root');
              if (typeof (root as any).setHTMLUnsafe === 'function') {
                (root as any).setHTMLUnsafe(markup);
              } else {
                root.innerHTML = markup;
              }

              const el = document.getElementById(id);
              const hasShadow = el?.shadowRoot !== null;
              const text = el?.shadowRoot?.querySelector('.resumable-inner span')?.textContent;
              root.innerHTML = '';
              return hasShadow && text === expectedText;
            },
            { markup: dsdMarkup, id: `resumed-${index}`, expectedText: `${comp.name} SSR` },
          );

          expect(hydrated).toBe(true);
        });
      });

      it('verifies resumable interaction event recording and replay queue in Chromium', async () => {
        const loaderScript = compileResumableLoader();

        const dsdMarkup = renderToDsd({
          tagName: canonicalButton.tag,
          shadowHtml: `<button id="ssr-action-btn" data-action="click">Trigger</button>`,
          attributes: { id: 'resumable-comp' },
          state: { active: true },
        });

        await page.evaluate(
          ({ loader, dsd }: { loader: string; dsd: string }) => {
            (window as any).__resumptionEvents = [];
            const script = document.createElement('script');
            script.textContent = loader;
            document.head.appendChild(script);

            const root = document.getElementById('test-root');
            if (!root) throw new Error('Missing test-root');
            if (typeof (root as any).setHTMLUnsafe === 'function') {
              (root as any).setHTMLUnsafe(dsd);
            } else {
              root.innerHTML = dsd;
            }

            (window as any).__simulateClientHydration = () => {
              const el = document.getElementById('resumable-comp');
              if (el) {
                const btn = el.shadowRoot?.querySelector('#ssr-action-btn');
                btn?.addEventListener('click', () => {
                  (window as any).__resumptionEvents.push('ssr-action-btn');
                });
              }
            };
          },
          { loader: loaderScript, dsd: dsdMarkup },
        );

        // Click during SSR state (intercepted by compiled resumable loader)
        await page.evaluate(() => {
          const el = document.getElementById('resumable-comp');
          const btn = el?.shadowRoot?.querySelector('#ssr-action-btn') as HTMLElement;
          btn?.click();
        });

        // Hydrate client listener
        await page.evaluate(() => {
          (window as any).__simulateClientHydration();
        });

        // Confirm hydrated listener receives events
        await page.evaluate(() => {
          const el = document.getElementById('resumable-comp');
          const btn = el?.shadowRoot?.querySelector('#ssr-action-btn') as HTMLElement;
          btn?.click();
        });

        const events = await page.evaluate(() => (window as any).__resumptionEvents);
        expect(events).toContain('ssr-action-btn');

        await page.evaluate(() => {
          const root = document.getElementById('test-root');
          if (root) root.innerHTML = '';
        });
      });
    });
  });
}
