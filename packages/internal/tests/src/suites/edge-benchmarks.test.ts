import fs from 'node:fs';
import { createSignedStateSnapshot, executePatches, handleActionRequest } from '@lit-core/server-elements';
import { splitServerElement } from '@lit-core/server-split';
import { installIsolateGlobals, renderToString } from '@lit-core/ssr';
import { html } from 'lit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { countMarkers, evaluateTargetA, evaluateTargetC, evaluateTargetD, runEdgeHeadToHeadBenchmark, verifyEdgeDesignSystemSsr } from '../../../benchmarks/src/features/edge-head-to-head.js';
import { closeTestBrowser, getShadowText, getTestBrowser, setupTestPage } from '../harness.js';

const executorDistPath = new URL('../../../../primitives/server-elements/dist/executor.js', import.meta.url);
const genuineExecutorScript = fs.readFileSync(executorDistPath, 'utf-8').replace(/^export\s+/gm, '');

describe('edge SSR and server elements head-to-head benchmark suite', () => {
  let browser: any;

  beforeAll(async () => {
    browser = await getTestBrowser();
  });

  afterAll(async () => {
    await closeTestBrowser();
  });

  describe('declarative Shadow DOM mounting and in-place patch execution', () => {
    it('mounts Declarative Shadow DOM and applies surgical ndjson action patch in place', async () => {
      const page = await setupTestPage({
        html: `
          <div class="product-container">
            <cart-action data-lit-ssr="cart-1"><template shadowrootmode="open"><div class="cart-control"><span class="cart-indicator">Cart (0)</span><button class="add-to-cart-btn">Add to cart</button><span class="cart-feedback"></span></div></template></cart-action>
          </div>
        `,
        script: `
          ${genuineExecutorScript}
          class CartAction extends HTMLElement {}
          if (!customElements.get('cart-action')) {
            customElements.define('cart-action', CartAction);
          }
        `,
      });

      // Verify Declarative Shadow DOM was automatically attached by Chromium
      const isAttached = await page.evaluate(() => {
        const host = document.querySelector('cart-action');
        return Boolean(host && host.shadowRoot && host.shadowRoot.mode === 'open');
      });
      expect(isAttached).toBe(true);

      const initialIndicator = await getShadowText(page, 'cart-action', '.cart-indicator');
      expect(initialIndicator).toBe('Cart (0)');

      // Apply simulated surgical patch frame emitted from @action() addToCart via genuine executor
      await page.evaluate(() => {
        const host = document.querySelector('cart-action') as HTMLElement;
        (window as any).__litExecutePatches(host, [
          { p: 0, v: 'Cart (1)' },
          { p: 1, v: 'Added 1 unit(s) of APX-9800 to cart' },
        ]);
      });

      const updatedIndicator = await getShadowText(page, 'cart-action', '.cart-indicator');
      expect(updatedIndicator).toBe('Cart (1)');

      const feedbackText = await getShadowText(page, 'cart-action', '.cart-feedback');
      expect(feedbackText).toBe('Added 1 unit(s) of APX-9800 to cart');
    });

    it('preserves input focus and selection range during surgical patch application', async () => {
      const page = await setupTestPage({
        html: `
          <cart-focus-action data-lit-ssr="cart-2"><template shadowrootmode="open"><div class="cart-control"><input type="text" class="promo-input" value="DISCOUNT2026" /><span class="cart-indicator">Cart (0)</span><span class="cart-feedback"></span></div></template></cart-focus-action>
        `,
        script: `
          ${genuineExecutorScript}
          class CartFocusAction extends HTMLElement {}
          if (!customElements.get('cart-focus-action')) {
            customElements.define('cart-focus-action', CartFocusAction);
          }
        `,
      });

      // Focus input and select characters 4 to 8 ("OUNT")
      await page.evaluate(() => {
        const host = document.querySelector('cart-focus-action');
        const input = host?.shadowRoot?.querySelector('.promo-input') as HTMLInputElement;
        input.focus();
        input.setSelectionRange(4, 8);
      });

      const selectionBefore = await page.evaluate(() => {
        const host = document.querySelector('cart-focus-action');
        const input = host?.shadowRoot?.querySelector('.promo-input') as HTMLInputElement;
        return {
          active: host?.shadowRoot?.activeElement === input,
          start: input.selectionStart,
          end: input.selectionEnd,
        };
      });

      expect(selectionBefore.active).toBe(true);
      expect(selectionBefore.start).toBe(4);
      expect(selectionBefore.end).toBe(8);

      // Apply surgical patch on sibling cart-indicator via genuine executor
      await page.evaluate(() => {
        const host = document.querySelector('cart-focus-action') as HTMLElement;
        (window as any).__litExecutePatches(host, [{ p: 1, v: 'Cart (1)' }]);
      });

      const selectionAfter = await page.evaluate(() => {
        const host = document.querySelector('cart-focus-action');
        const input = host?.shadowRoot?.querySelector('.promo-input') as HTMLInputElement;
        return {
          active: host?.shadowRoot?.activeElement === input,
          start: input.selectionStart,
          end: input.selectionEnd,
        };
      });

      // Assert focus and selection were not reset
      expect(selectionAfter.active).toBe(true);
      expect(selectionAfter.start).toBe(4);
      expect(selectionAfter.end).toBe(8);

      const updatedIndicator = await getShadowText(page, 'cart-focus-action', '.cart-indicator');
      expect(updatedIndicator).toBe('Cart (1)');

      // Apply surgical property patch directly on the focused input via genuine executor with prefix '.'
      await page.evaluate(() => {
        const host = document.querySelector('cart-focus-action') as HTMLElement;
        (window as any).__litExecutePatches(host, [{ p: 0, v: 'DISCOUNT_UPDATED' }]);
      });

      const inputSelectionAfterProp = await page.evaluate(() => {
        const host = document.querySelector('cart-focus-action');
        const input = host?.shadowRoot?.querySelector('.promo-input') as HTMLInputElement;
        return {
          value: input.value,
          active: host?.shadowRoot?.activeElement === input,
          start: input.selectionStart,
          end: input.selectionEnd,
        };
      });

      expect(inputSelectionAfterProp.value).toBe('DISCOUNT_UPDATED');
      expect(inputSelectionAfterProp.active).toBe(true);
      expect(inputSelectionAfterProp.start).toBe(4);
      expect(inputSelectionAfterProp.end).toBe(8);
    });
  });

  describe('minimal markers and progressive out-of-order streaming', () => {
    it('verifies zero comment markers on element and sole-text parts', () => {
      const templateHtml = `
        <div class="product-hero">
          <h1 class="title">Apex Pro</h1>
          <span class="price">$189.99</span>
          <span class="desc">Free shipping</span>
        </div>
      `;

      const markers = countMarkers(templateHtml);
      expect(markers.commentMarkersCount).toBe(0);
      expect(markers.rangeMarkersCount).toBe(0);
      expect(markers.totalMarkersCount).toBe(0);
    });

    it('verifies progressive streaming timeline with t_fast strictly earlier than t_slow', async () => {
      const targetA = await evaluateTargetA();

      expect(targetA.streamingTimeline.ttfbMs).toBeGreaterThan(0);
      expect(targetA.streamingTimeline.fastChunkMs).toBeGreaterThanOrEqual(targetA.streamingTimeline.ttfbMs);
      expect(targetA.streamingTimeline.slowChunkMs).toBeGreaterThan(targetA.streamingTimeline.fastChunkMs);
      expect(targetA.streamingTimeline.ttlbMs).toBeGreaterThanOrEqual(targetA.streamingTimeline.slowChunkMs);
      expect(targetA.streamingTimeline.progressiveVerified).toBe(true);
      expect(targetA.streamingTimeline.headOfLineBlocking).toBe(false);
    });

    it('confirms naive HTMLRewriter suffers from head-of-line blocking', async () => {
      const targetC = await evaluateTargetC();

      expect(targetC.streamingTimeline.headOfLineBlocking).toBe(true);
      expect(targetC.streamingTimeline.progressiveVerified).toBe(false);
      expect(targetC.streamingTimeline.ttfbMs).toBeGreaterThan(0);
      expect(targetC.streamingTimeline.fastChunkMs).toBeGreaterThanOrEqual(targetC.streamingTimeline.ttfbMs);
    });
  });

  describe('design system edge SSR verification in clean isolates', () => {
    it('verifies IBM Carbon, Adobe Spectrum, Web Awesome, and Material Web emit zero comment markers', async () => {
      const results = await verifyEdgeDesignSystemSsr();

      expect(results).toHaveLength(4);
      for (const ds of results) {
        expect(ds.zeroCommentMarkersVerified).toBe(true);
        expect(ds.commentMarkersCount).toBe(0);
        expect(ds.cpuTimeMs).toBeLessThan(10);
      }
    });
  });

  describe('head-to-head empirical metrics validation', () => {
    it('executes head-to-head benchmark runner and validates schema and invariants', async () => {
      const result = await runEdgeHeadToHeadBenchmark();

      expect(result.schemaVersion).toBe('1.0.0');
      expect(result.benchmarkId).toBe('edge-head-to-head');
      expect(result.suites).toHaveLength(3);

      const targetA = result.suites.find((s: any) => s.id === 'target-a');
      const targetC = result.suites.find((s: any) => s.id === 'target-c');
      const targetD = result.suites.find((s: any) => s.id === 'target-d');

      expect(targetA).toBeDefined();
      expect(targetC).toBeDefined();
      expect(targetD).toBeDefined();

      // Invariant 1: Target A client JS savings vs Naive baseline
      expect(result.summary?.clientJsSavingsVsBaselinePercent).toBeDefined();

      // Invariant 2: Target A action response wire savings vs Naive baseline
      expect(result.summary?.actionWireSavingsVsBaselinePercent).toBeDefined();

      // Invariant 3: Real workerd CPU and Node.js CPU timings are measured and labeled separately
      expect(targetA!.metrics.workerdRenderCpuMedianMs).toBeGreaterThan(0);
      expect(targetA!.metrics.workerdRenderCpuMedianMs).toBeLessThan(10);
      expect(targetA!.metrics.workerdCpuEnvironment).toMatch(/^Cloudflare workerd\b/);
      expect(targetA!.metrics.nodeRenderCpuMedianMs).toBeGreaterThan(0);
      expect(targetA!.metrics.nodeCpuEnvironment).toMatch(/^Node\.js\b/);

      // Invariant 4: Plain SSR emits 0 comment markers and full server-element HTML emits strictly fewer than Target D
      expect(targetA!.metrics.commentMarkersCount).toBeLessThan(targetD!.metrics.commentMarkersCount);
      expect(targetD!.metrics.commentMarkersCount).toBeGreaterThan(0);
      expect((result as any).plainSsr.workloads.find((w: any) => w.id === 'product-page').litCore.commentMarkersCount).toBe(0);
    });
  });
});
