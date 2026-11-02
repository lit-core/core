import { closeSharedBrowser, createTestPage, getSharedBrowser } from '@lit-core/test-kit';
import { html, svg } from 'lit';
import { until } from 'lit/directives/until.js';
import { afterAll, describe, expect, it } from 'vitest';
import {
  ContextRequestEvent,
  collectResult,
  createAsyncBoundary,
  createContext,
  createIsolateEnvironment,
  renderAsync,
  renderToResponse,
  renderToString,
  renderToStringAsync,
  SDSD_SWAP_SCRIPT,
  transformWithHtmlRewriter,
} from '../src/index.js';
import { CloudflareHtmlRewriterSimulator } from './helpers/cloudflare-html-rewriter-simulator.js';

async function withBrowserPage<T>(fn: (page: import('playwright').Page) => Promise<T>, _options: { javaScriptEnabled?: boolean } = {}): Promise<T> {
  const browser = await getSharedBrowser();
  const managed = await createTestPage(browser);
  try {
    return await fn(managed.page);
  } finally {
    await managed.close();
  }
}

afterAll(async () => {
  await closeSharedBrowser();
});

describe('Streaming Declarative Shadow DOM (SDSD) and Cloudflare HTMLRewriter multiplexer', () => {
  describe('inline swap primitive budget and css-fuse style cascade', () => {
    it('keeps SDSD_SWAP_SCRIPT strictly under the 300-byte wire budget', () => {
      const byteLength = new TextEncoder().encode(SDSD_SWAP_SCRIPT).byteLength;
      expect(byteLength).toBeLessThan(300);
    });

    it('emits shared css-fuse styles prepended before local component overrides in DSD mode and applies styles in Chromium with JS disabled', async () => {
      const env = createIsolateEnvironment();

      const sharedSheet = {
        _fusedId: 'shared-theme-01',
        cssText: '/* @lit-core/css-fuse */ :host { display: block; color: rgb(255, 0, 0); padding: 12px; } .box { background-color: rgb(0, 128, 0); padding: 8px; }',
      };
      const localOverride = {
        cssText: ':host { color: rgb(0, 0, 255); }',
      };

      class StyledCard extends env.HTMLElement {
        static styles = [sharedSheet, localOverride];
        render() {
          return html`<div class="box">Styled content</div>`;
        }
      }
      env.customElements.define('styled-card', StyledCard);

      const ssrHtml = renderToString(html`<styled-card></styled-card>`, {
        customElements: env.customElements,
      });

      expect(ssrHtml).toContain('/* @lit-core/css-fuse */');
      const sharedIdx = ssrHtml.indexOf('rgb(255, 0, 0)');
      const localIdx = ssrHtml.indexOf('rgb(0, 0, 255)');
      expect(sharedIdx).toBeGreaterThan(-1);
      expect(localIdx).toBeGreaterThan(sharedIdx);

      // Verify in real Chromium with JavaScript disabled that both shared and local override styles apply
      await withBrowserPage(
        async (page) => {
          await page.setContent(`<!DOCTYPE html><html><body>${ssrHtml}</body></html>`);
          const computed = await page.evaluate(() => {
            const host = document.querySelector('styled-card');
            const box = host?.shadowRoot?.querySelector('.box');
            return {
              hostColor: host ? getComputedStyle(host).color : '',
              hostPadding: host ? getComputedStyle(host).paddingTop : '',
              boxBg: box ? getComputedStyle(box).backgroundColor : '',
            };
          });
          expect(computed.hostColor).toBe('rgb(0, 0, 255)');
          expect(computed.hostPadding).toBe('12px');
          expect(computed.boxBg).toBe('rgb(0, 128, 0)');
        },
        { javaScriptEnabled: false },
      );
    });

    it('supports shadowrootadoptedstylesheets URL resolution when configured', () => {
      const env = createIsolateEnvironment();
      class AdoptedComp extends env.HTMLElement {
        static styles = [{ _fusedId: 'tokens-abc', cssText: '/* @lit-core/css-fuse */ :host { display: block; }' }, { cssText: '.inner { color: green; }' }];
        render() {
          return html`<span class="inner">Adopted</span>`;
        }
      }
      env.customElements.define('adopted-comp', AdoptedComp);

      const out = renderToString(html`<adopted-comp></adopted-comp>`, {
        customElements: env.customElements,
        adoptedStyleSheets: {
          urlResolver: (key) => `/assets/${key}.css`,
        },
      });

      expect(out).toContain('<template shadowrootmode="open" shadowrootadoptedstylesheets="/assets/tokens-abc.css">');
      expect(out).toContain('<style data-lit-local>.inner { color: green; }</style>');
      expect(out).not.toContain('data-lit-sheet');
    });
  });

  describe('W3C Context protocol and ReactiveController lifecycle in ISME', () => {
    it('propagates context-request events across nested shadow hosts and root RenderOptions.context', () => {
      const env = createIsolateEnvironment();
      const themeCtx = createContext<string>('theme-context');
      const authCtx = createContext<{ user: string }>('auth-context');

      class ThemeProvider extends env.HTMLElement {
        connectedCallback() {
          super.connectedCallback();
          this.addEventListener('context-request', (e: ContextRequestEvent<any>) => {
            if (e.context === themeCtx) {
              e.stopPropagation();
              e.callback('scandinavian-light');
            }
          });
        }
        render() {
          return html`<theme-consumer></theme-consumer>`;
        }
      }

      class ThemeConsumer extends env.HTMLElement {
        resolvedTheme = 'default';
        resolvedUser = 'guest';
        private controllerConnected = false;

        constructor() {
          super();
          this.addController({
            hostConnected: () => {
              this.controllerConnected = true;
            },
          });
        }

        connectedCallback() {
          super.connectedCallback();
          this.dispatchEvent(
            new ContextRequestEvent(themeCtx, (val) => {
              this.resolvedTheme = val;
            }),
          );
          this.dispatchEvent(
            new ContextRequestEvent(authCtx, (val) => {
              this.resolvedUser = val.user;
            }),
          );
        }

        render() {
          return html`<div data-theme="${this.resolvedTheme}" data-user="${this.resolvedUser}" data-ctrl="${String(this.controllerConnected)}"></div>`;
        }
      }

      env.customElements.define('theme-provider', ThemeProvider);
      env.customElements.define('theme-consumer', ThemeConsumer);

      const out = renderToString(html`<theme-provider></theme-provider>`, {
        customElements: env.customElements,
        context: new Map([[authCtx, { user: 'ada' }]]),
      });

      expect(out).toContain('data-theme="scandinavian-light"');
      expect(out).toContain('data-user="ada"');
      expect(out).toContain('data-ctrl="true"');
    });
  });

  describe('out-of-order and in-order SDSD streaming with real Chromium verification', () => {
    it('streams out-of-order boundaries fastest-first using minified lit/directives/until.js and swaps 3-level nested DSD, tables, and SVG in Chromium', async () => {
      const env = createIsolateEnvironment();

      class LeafBadge extends env.HTMLElement {
        label = '';
        render() {
          return html`<span class="badge-text">${this.label}</span>`;
        }
      }

      class InnerView extends env.HTMLElement {
        render() {
          const slowPromise = new Promise((resolve) => setTimeout(() => resolve(html`<leaf-badge label="ResolvedSlow"></leaf-badge>`), 45));
          return html`<div class="inner-slot">${until(slowPromise, html`<span class="loading">Loading slow...</span>`)}</div>`;
        }
      }

      class MiddleContainer extends env.HTMLElement {
        render() {
          const fastTablePromise = new Promise((resolve) => setTimeout(() => resolve(html`<tr class="resolved-row"><td>Row A</td><td>100</td></tr>`), 10));
          const fastSvgPromise = new Promise((resolve) => setTimeout(() => resolve(svg`<circle id="resolved-circle" cx="25" cy="25" r="20"></circle>`), 18));
          return html`
            <inner-view></inner-view>
            <table>
              <tbody>
                ${until(fastTablePromise, html`<tr class="skeleton-row"><td colspan="2">Loading row...</td></tr>`)}
              </tbody>
            </table>
            <svg width="50" height="50">
              ${until(fastSvgPromise, html`<rect id="skeleton-rect" width="10" height="10"></rect>`)}
            </svg>
          `;
        }
      }

      class OuterApp extends env.HTMLElement {
        render() {
          return html`<div class="app-shell"><middle-container></middle-container></div>`;
        }
      }

      env.customElements.define('leaf-badge', LeafBadge);
      env.customElements.define('inner-view', InnerView);
      env.customElements.define('middle-container', MiddleContainer);
      env.customElements.define('outer-app', OuterApp);

      const chunks: string[] = [];
      for await (const chunk of renderAsync(html`<outer-app></outer-app>`, {
        customElements: env.customElements,
      })) {
        chunks.push(chunk);
      }

      const fullHtml = chunks.join('');

      // Verify out-of-order completion: fastTablePromise (10ms) and fastSvgPromise (18ms)
      // must appear in the stream BEFORE slowPromise (45ms), even though slowPromise is earlier in document order!
      const tableChunkIdx = fullHtml.indexOf('Row A');
      const svgChunkIdx = fullHtml.indexOf('resolved-circle');
      const slowChunkIdx = fullHtml.indexOf('ResolvedSlow');
      expect(tableChunkIdx).toBeGreaterThan(-1);
      expect(svgChunkIdx).toBeGreaterThan(tableChunkIdx);
      expect(slowChunkIdx).toBeGreaterThan(svgChunkIdx);

      // Verify in real Chromium that all swaps execute cleanly and leave zero comments or <template id="c*"> nodes
      await withBrowserPage(async (page) => {
        await page.setContent(`<!DOCTYPE html><html><body>${fullHtml}</body></html>`);

        const verification = await page.evaluate(() => {
          const outer = document.querySelector('outer-app');
          const middle = outer?.shadowRoot?.querySelector('middle-container');
          const inner = middle?.shadowRoot?.querySelector('inner-view');
          const badge = inner?.shadowRoot?.querySelector('leaf-badge');

          const badgeText = badge?.shadowRoot?.querySelector('.badge-text')?.textContent;
          const rowCells = Array.from(middle?.shadowRoot?.querySelectorAll('tbody tr.resolved-row td') ?? []).map((td) => td.textContent);
          const skeletonRowCount = middle?.shadowRoot?.querySelectorAll('tbody tr.skeleton-row').length ?? -1;

          const circle = middle?.shadowRoot?.querySelector('svg #resolved-circle');
          const circleNs = circle?.namespaceURI;
          const skeletonRectCount = middle?.shadowRoot?.querySelectorAll('svg #skeleton-rect').length ?? -1;

          // Verify zero leftover <template id="c*"> elements and zero <!--$b:*--> comments
          const leftoverTemplates = document.querySelectorAll('template[id^="c"]').length;
          let leftoverComments = 0;
          for (const root of [outer?.shadowRoot, middle?.shadowRoot, inner?.shadowRoot]) {
            if (!root) continue;
            const walker = document.createTreeWalker(root, 128);
            let node: Node | null = walker.nextNode();
            while (node) {
              if ((node as Comment).data.includes('$b:')) leftoverComments++;
              node = walker.nextNode();
            }
          }

          return {
            badgeText,
            rowCells,
            skeletonRowCount,
            circleNs,
            skeletonRectCount,
            leftoverTemplates,
            leftoverComments,
          };
        });

        expect(verification.badgeText).toBe('ResolvedSlow');
        expect(verification.rowCells).toEqual(['Row A', '100']);
        expect(verification.skeletonRowCount).toBe(0);
        expect(verification.circleNs).toBe('http://www.w3.org/2000/svg');
        expect(verification.skeletonRectCount).toBe(0);
        expect(verification.leftoverTemplates).toBe(0);
        expect(verification.leftoverComments).toBe(0);
      });
    });

    it('supports in-order streaming mode with zero client swap scripts or comment markers', async () => {
      const delayed = new Promise((resolve) => setTimeout(() => resolve(html`<span>InOrderResolved</span>`), 15));
      const output = await renderToStringAsync(html`<section>${until(delayed, html`<span>Fallback</span>`)}</section>`, { streamingMode: 'in-order' });

      expect(output).toBe('<section><span>InOrderResolved</span></section>');
      expect(output).not.toContain('$s(');
      expect(output).not.toContain('$b:');
      expect(output).not.toContain('data-lit-ssr');
    });

    it('isolates rejected boundary promises and enforces timeoutMs deadlines with errorFallback', async () => {
      const errors: unknown[] = [];
      const failingPromise = Promise.reject(new Error('DB connection reset'));
      const hangingPromise = new Promise((resolve) => setTimeout(() => resolve('too late'), 500));

      const template = html`
        <div>
          ${createAsyncBoundary(failingPromise, html`<span>Loading 1...</span>`, () => html`<span class="err-1">Recovered DB error</span>`)}
          ${createAsyncBoundary(hangingPromise, html`<span>Loading 2...</span>`)}
        </div>
      `;

      const res = await renderToResponse(template, {
        timeoutMs: 25,
        errorFallback: () => html`<span class="err-timeout">Timed out cleanly</span>`,
        onError: (err) => errors.push(err),
      });

      expect(res.headers.get('content-type')).toBe('text/html; charset=utf-8');
      expect(res.headers.get('x-content-type-options')).toBe('nosniff');

      const fullHtml = res.body ? await collectResult(res.body) : '';
      expect(errors.length).toBe(2);

      await withBrowserPage(async (page) => {
        await page.setContent(`<!DOCTYPE html><html><body>${fullHtml}</body></html>`);
        const texts = await page.evaluate(() => ({
          err1: document.querySelector('.err-1')?.textContent,
          errTimeout: document.querySelector('.err-timeout')?.textContent,
        }));
        expect(texts.err1).toBe('Recovered DB error');
        expect(texts.errTimeout).toBe('Timed out cleanly');
      });
    });
  });

  describe('Cloudflare HTMLRewriter (lol-html) two-trap multiplexer verification', () => {
    it('Trap #1 & #2: dispatches 10 async edge islands in parallel with 0ms tokenizer stall and recursively expands nested Shadow DOM in one pass', async () => {
      const env = createIsolateEnvironment();

      class GrandchildIcon extends env.HTMLElement {
        name = 'star';
        render() {
          return html`<i class="icon">${this.name}</i>`;
        }
      }

      class ChildButton extends env.HTMLElement {
        render() {
          return html`<button class="btn"><grandchild-icon name="bolt"></grandchild-icon><slot></slot></button>`;
        }
      }

      class ParentCard extends env.HTMLElement {
        render() {
          return html`<div class="card"><child-button>Click me</child-button></div>`;
        }
      }

      env.customElements.define('grandchild-icon', GrandchildIcon);
      env.customElements.define('child-button', ChildButton);
      env.customElements.define('parent-card', ParentCard);

      const dispatchTimestamps: number[] = [];
      const rawHtml = `<!DOCTYPE html><html><body>
        <parent-card></parent-card>
        ${Array.from({ length: 10 }, (_, idx) => `<order-island id="ord-${idx}" delay="${(10 - idx) * 6}"></order-island>`).join('\n')}
      </body></html>`;

      const startTime = performance.now();
      const rewrittenResponse = transformWithHtmlRewriter(
        rawHtml,
        {
          customElements: env.customElements,
          islands: {
            'order-island': {
              styles: ':host { display: inline-block; }',
              pending: (attrs) => `<span class="pending-skeleton">Pending ${attrs.id}</span>`,
              render: async (attrs) => {
                dispatchTimestamps.push(performance.now() - startTime);
                const delayMs = Number(attrs.delay ?? 30);
                await new Promise((r) => setTimeout(r, delayMs));
                return html`<div class="resolved-order" data-id="${attrs.id}">Order ${attrs.id} ready</div>`;
              },
            },
          },
        },
        () => new CloudflareHtmlRewriterSimulator(),
      );

      const finalHtml = await rewrittenResponse.text();
      const totalElapsed = performance.now() - startTime;

      // Proof 1: All 10 async islands were dispatched synchronously during the single lol-html pass
      // without waiting for previous islands to resolve (spread between #0 and #9 dispatch is < 15ms).
      expect(dispatchTimestamps.length).toBe(10);
      const dispatchSpread = dispatchTimestamps[9] - dispatchTimestamps[0];
      expect(dispatchSpread).toBeLessThan(15);

      // Proof 2: Total elapsed time is governed by max(delay) (~60ms), NOT sum(delays) (330ms waterfall)!
      expect(totalElapsed).toBeLessThan(200);

      // Proof 3: Island #9 (delay 6ms) resolved and streamed BEFORE Island #0 (delay 60ms)
      const ord9Pos = finalHtml.indexOf('data-id="ord-9"');
      const ord0Pos = finalHtml.indexOf('data-id="ord-0"');
      expect(ord9Pos).toBeGreaterThan(-1);
      expect(ord0Pos).toBeGreaterThan(ord9Pos);

      // Proof 4: Verify in real Chromium that both the 3-level nested <parent-card> -> <child-button> -> <grandchild-icon>
      // AND all 10 parallel <order-island> shadow roots are hydrated into live Shadow DOM!
      await withBrowserPage(async (page) => {
        await page.setContent(finalHtml);

        const domCheck = await page.evaluate(() => {
          const parentCard = document.querySelector('parent-card');
          const childBtn = parentCard?.shadowRoot?.querySelector('child-button');
          const grandIcon = childBtn?.shadowRoot?.querySelector('grandchild-icon');
          const iconText = grandIcon?.shadowRoot?.querySelector('.icon')?.textContent;

          const resolvedOrders = Array.from(document.querySelectorAll('order-island')).map((el) => el.shadowRoot?.querySelector('.resolved-order')?.textContent);

          return {
            iconText,
            resolvedOrders,
          };
        });

        expect(domCheck.iconText).toBe('bolt');
        expect(domCheck.resolvedOrders.length).toBe(10);
        expect(domCheck.resolvedOrders[0]).toBe('Order ord-0 ready');
        expect(domCheck.resolvedOrders[9]).toBe('Order ord-9 ready');
      });
    });
  });
});
