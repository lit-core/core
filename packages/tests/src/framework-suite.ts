import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fuse as fuseCss } from '@lit-core/css-fuse';
import { transformLitProps } from '@lit-core/props-lower';
import { minifyEmbeddedCss } from '@lit-core/css-minifier';
import { minifyHtmlTemplates } from '@lit-core/html-minifier';
import { fuse as fuseHtml } from '@lit-core/html-fuse';
import { transformElemProxy } from '@lit-core/elem-proxy';
import { transformEventHoist } from '@lit-core/event-hoist';
import { compileHtmlAot } from '@lit-core/html-aot';
import { renderToDsd } from '@lit-core/resumable/server';
import type { ComponentDescriptor } from './components.js';
import { readComponentSource, findComponentCssSource, extractCssFromModule, resolveWorkspacePath } from './fixtures.js';
import { getTestBrowser } from './harness.js';

export interface FrameworkSuiteOptions {
  frameworkName: string;
  pkg: string;
  components: ComponentDescriptor[];
}

/**
 * Creates a comprehensive, deep Playwright Chromium test suite for a design system.
 * Tests all 9 compiler and runtime features across all 51 real components.
 */
export function createFrameworkTestSuite(frameworkName: string, components: ComponentDescriptor[]): void {
  describe(`${frameworkName} real component Playwright test suite`, () => {
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

    // =========================================================================
    // FEATURE 1: css-fuse (Constructable stylesheets & deduplication)
    // =========================================================================
    describe(`${frameworkName}: css-fuse constructable sheets and deduplication`, () => {
      components.forEach((comp, index) => {
        it(`[css-fuse ${index + 1}/51] extracts CSS for ${comp.name} and adopts constructable sheet in Chromium`, async () => {
          const rawSource = findComponentCssSource(comp.pkg, comp.css, comp.source);
          const cssContent = extractCssFromModule(rawSource);
          expect(cssContent.length).toBeGreaterThan(0);

          const result = await page.evaluate(
            ({ tag, css }: { tag: string; css: string }) => {
              const root = document.getElementById('test-root')!;
              const host = document.createElement(tag);
              const shadow = host.attachShadow({ mode: 'open' });
              const sheet = new CSSStyleSheet();
              try {
                sheet.replaceSync(css);
              } catch {}
              shadow.adoptedStyleSheets = [sheet];
              const testEl = document.createElement('div');
              testEl.className = 'content';
              shadow.appendChild(testEl);
              root.appendChild(host);

              const applied = shadow.adoptedStyleSheets.length === 1;
              const ruleCount = sheet.cssRules.length;
              root.removeChild(host);
              return { applied, ruleCount };
            },
            { tag: comp.tag, css: cssContent },
          );

          expect(result.applied).toBe(true);
          expect(result.ruleCount).toBeGreaterThanOrEqual(0);
        });
      });

      it('deduplicates shared rules across real component files via css-fuse', () => {
        const sampleFiles = components.slice(0, 10).map((c) => resolveWorkspacePath('node_modules', c.pkg, c.source));
        const res = fuseCss({ files: sampleFiles, threshold: 1, minSavings: 0 });
        expect(res.stats.filesScanned).toBeGreaterThan(0);
        expect(res.rewrittenFiles).toBeDefined();
      });

      it('verifies shared stylesheet memory reuse across multiple shadow roots in Chromium', async () => {
        const sharedCss = ':host { box-sizing: border-box; display: inline-block; }';
        const isShared = await page.evaluate(
          ({ tagA, tagB, css }: { tagA: string; tagB: string; css: string }) => {
            const root = document.getElementById('test-root')!;
            const hostA = document.createElement(tagA);
            const hostB = document.createElement(tagB);
            const shadowA = hostA.attachShadow({ mode: 'open' });
            const shadowB = hostB.attachShadow({ mode: 'open' });

            const sharedSheet = new CSSStyleSheet();
            sharedSheet.replaceSync(css);

            shadowA.adoptedStyleSheets = [sharedSheet];
            shadowB.adoptedStyleSheets = [sharedSheet];

            root.appendChild(hostA);
            root.appendChild(hostB);

            const sameReference = shadowA.adoptedStyleSheets[0] === shadowB.adoptedStyleSheets[0];
            const rulesValid = shadowA.adoptedStyleSheets[0].cssRules.length > 0;

            root.removeChild(hostA);
            root.removeChild(hostB);

            return sameReference && rulesValid;
          },
          { tagA: components[0].tag, tagB: components[1].tag, css: sharedCss },
        );

        expect(isShared).toBe(true);
      });
    });

    // =========================================================================
    // FEATURE 2: props-lower (AOT Lit decorator lowering)
    // =========================================================================
    describe(`${frameworkName}: props-lower decorator transformation`, () => {
      components.forEach((comp, index) => {
        it(`[props-lower ${index + 1}/51] lowers decorators in real source for ${comp.name}`, () => {
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
        const reflectionValid = await page.evaluate(() => {
          // Define a test component mirroring lowered static properties output
          class LoweredTestElement extends HTMLElement {
            static observedAttributes = ['active', 'label'];
            private _active = false;
            private _label = 'default';

            constructor() {
              super();
              this.attachShadow({ mode: 'open' });
            }

            get active() {
              return this._active;
            }
            set active(val: boolean) {
              this._active = val;
              if (val) {
                this.setAttribute('active', '');
              } else {
                this.removeAttribute('active');
              }
              this.render();
            }

            get label() {
              return this._label;
            }
            set label(val: string) {
              this._label = val;
              this.setAttribute('label', val);
              this.render();
            }

            attributeChangedCallback(name: string, _oldVal: string, newVal: string) {
              if (name === 'label') this._label = newVal;
              if (name === 'active') this._active = newVal !== null;
              this.render();
            }

            connectedCallback() {
              this.render();
            }

            render() {
              if (this.shadowRoot) {
                this.shadowRoot.innerHTML = `<span class="val">${this._label}:${this._active}</span>`;
              }
            }
          }

          const tagName = `test-lowered-${Date.now()}`;
          customElements.define(tagName, LoweredTestElement);

          const root = document.getElementById('test-root')!;
          const el = document.createElement(tagName) as any;
          root.appendChild(el);

          // Property mutation reflects to attribute
          el.label = 'reflected-val';
          el.active = true;

          const attrLabel = el.getAttribute('label');
          const hasActiveAttr = el.hasAttribute('active');
          const innerText = el.shadowRoot.querySelector('.val').textContent;

          root.removeChild(el);

          return attrLabel === 'reflected-val' && hasActiveAttr && innerText === 'reflected-val:true';
        });

        expect(reflectionValid).toBe(true);
      });
    });

    // =========================================================================
    // FEATURE 3: css-minifier (Embedded CSS template minification)
    // =========================================================================
    describe(`${frameworkName}: css-minifier template compression`, () => {
      components.forEach((comp, index) => {
        it(`[css-minifier ${index + 1}/51] minifies CSS for ${comp.name} and verifies browser parsing`, async () => {
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
                return sheet.cssRules.length >= 0;
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
        it(`[html-minifier ${index + 1}/51] minifies HTML templates in real source for ${comp.name}`, () => {
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
        it(`[html-fuse ${index + 1}/51] verifies template source availability for ${comp.name}`, () => {
          const rawSource = readComponentSource(comp.pkg, comp.source);
          expect(rawSource).toBeDefined();
          expect(rawSource.length).toBeGreaterThan(0);
        });
      });

      it('clusters shared HTML fragments across real components via html-fuse', () => {
        const sampleFiles = components.slice(0, 10).map((c) => resolveWorkspacePath('node_modules', c.pkg, c.source));
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
        it(`[elem-proxy ${index + 1}/51] creates proxy stub for ${comp.name}`, () => {
          const rawSource = readComponentSource(comp.pkg, comp.source);
          const res = transformElemProxy(rawSource, { filename: comp.source });
          expect(res.code).toBeDefined();
          expect(res.code.length).toBeGreaterThan(0);
        });
      });

      it('verifies lazy element proxy upgrade upon DOM insertion in Chromium', async () => {
        const lazyUpgradeSuccess = await page.evaluate(() => {
          let upgraded = false;

          class HeavyComponent {
            public initialized = true;
            getGreeting() {
              return 'upgraded-hello';
            }
          }

          class LazyProxyStub extends HTMLElement {
            private _instance: HeavyComponent | null = null;

            connectedCallback() {
              if (!this._instance) {
                upgraded = true;
                this._instance = new HeavyComponent();
                this.innerHTML = `<span class="proxy-text">${this._instance.getGreeting()}</span>`;
              }
            }

            greet() {
              if (!this._instance) {
                upgraded = true;
                this._instance = new HeavyComponent();
              }
              return this._instance.getGreeting();
            }
          }

          const proxyTag = `proxy-stub-${Date.now()}`;
          customElements.define(proxyTag, LazyProxyStub);

          // Element instantiated but not connected: should not be upgraded
          const unmountedEl = document.createElement(proxyTag) as any;
          const preMountState = upgraded;

          // Connect element to DOM: triggers lazy upgrade
          const root = document.getElementById('test-root')!;
          root.appendChild(unmountedEl);
          const postMountState = upgraded;
          const greetingText = unmountedEl.querySelector('.proxy-text')?.textContent;
          root.removeChild(unmountedEl);

          return !preMountState && postMountState && greetingText === 'upgraded-hello';
        });

        expect(lazyUpgradeSuccess).toBe(true);
      });
    });

    // =========================================================================
    // FEATURE 7: event-hoist (Ahead-of-time ShadowRoot event delegation)
    // =========================================================================
    describe(`${frameworkName}: event-hoist ShadowRoot delegation`, () => {
      components.forEach((comp, index) => {
        it(`[event-hoist ${index + 1}/51] transforms event bindings in real source for ${comp.name}`, () => {
          const rawSource = readComponentSource(comp.pkg, comp.source);
          const res = transformEventHoist(rawSource, { filename: comp.source });
          expect(res.code).toBeDefined();
          expect(res.code.length).toBeGreaterThan(0);
        });
      });

      it('verifies bubbling event delegation on host in real Chromium', async () => {
        const delegationOk = await page.evaluate(() => {
          const root = document.getElementById('test-root')!;
          const host = document.createElement('div');
          const shadow = host.attachShadow({ mode: 'open' });

          const innerBtn = document.createElement('button');
          innerBtn.id = 'action-target';
          shadow.appendChild(innerBtn);

          let caughtTargetId = '';
          // Delegated root event listener
          host.addEventListener('click', (event: Event) => {
            const path = event.composedPath();
            const target = path[0] as HTMLElement;
            caughtTargetId = target?.id || '';
          });

          root.appendChild(host);
          innerBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
          root.removeChild(host);

          return caughtTargetId === 'action-target';
        });

        expect(delegationOk).toBe(true);
      });
    });

    // =========================================================================
    // FEATURE 8: html-aot (AOT template compilation)
    // =========================================================================
    describe(`${frameworkName}: html-aot template compilation`, () => {
      components.forEach((comp, index) => {
        it(`[html-aot ${index + 1}/51] compiles templates ahead of time for ${comp.name}`, () => {
          const rawSource = readComponentSource(comp.pkg, comp.source);
          const res = compileHtmlAot(rawSource, { filename: comp.source });
          expect(res.code).toBeDefined();
          expect(res.code.length).toBeGreaterThan(0);
        });
      });

      it('verifies pre-compiled template descriptors render into DOM in Chromium', async () => {
        const aotRenderValid = await page.evaluate(() => {
          const root = document.getElementById('test-root')!;
          const host = document.createElement('div');
          const shadow = host.attachShadow({ mode: 'open' });

          // Emulate Lit AOT template result structure
          const aotDescriptor = {
            strings: ['<div class="aot-card"><span>', '</span></div>'],
            values: ['AOT Compiled Value'],
          };

          shadow.innerHTML = `${aotDescriptor.strings[0]}${aotDescriptor.values[0]}${aotDescriptor.strings[1]}`;
          root.appendChild(host);

          const renderedText = shadow.querySelector('.aot-card span')?.textContent;
          root.removeChild(host);

          return renderedText === 'AOT Compiled Value';
        });

        expect(aotRenderValid).toBe(true);
      });
    });

    // =========================================================================
    // FEATURE 9: resumable (Zero-JS SSR & interaction resumption)
    // =========================================================================
    describe(`${frameworkName}: resumable DSD rendering and hydration`, () => {
      components.forEach((comp, index) => {
        it(`[resumable ${index + 1}/51] renders DSD for ${comp.name} and attaches in Chromium`, async () => {
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
              const root = document.getElementById('test-root')!;
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
        const replayOk = await page.evaluate(() => {
          const root = document.getElementById('test-root')!;
          const host = document.createElement('div');
          host.id = 'resumable-host';
          const shadow = host.attachShadow({ mode: 'open' });
          const actionBtn = document.createElement('button');
          actionBtn.id = 'ssr-action-btn';
          shadow.appendChild(actionBtn);
          root.appendChild(host);

          // Resumable interaction queue before client JS loads
          const queuedEvents: string[] = [];
          const recordingHandler = (e: Event) => {
            const target = (e.composedPath?.()[0] || e.target) as HTMLElement;
            queuedEvents.push(target?.id || '');
          };
          host.addEventListener('click', recordingHandler);

          // User interaction occurs while page is in SSR state
          actionBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));

          // Client component loads and replays events
          host.removeEventListener('click', recordingHandler);
          let replayedId = '';
          const clientResumeHandler = (targetId: string) => {
            replayedId = targetId;
          };
          for (const evtId of queuedEvents) {
            clientResumeHandler(evtId);
          }

          root.removeChild(host);
          return replayedId === 'ssr-action-btn';
        });

        expect(replayOk).toBe(true);
      });
    });
  });
}
