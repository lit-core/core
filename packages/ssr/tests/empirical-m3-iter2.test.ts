import { html } from 'lit';
import { describe, expect, it } from 'vitest';
import { collectResult, createIsolateEnvironment, DocumentStub, defaultDocumentStub, HTMLElementStub, KeyboardEventStub, renderToStream, StyleDeduplicator } from '../src/index.js';

describe('empirical challenger m3 iter2: style deduplication and streaming integrity', () => {
  describe('sharedEntries preservation and StyleDeduplicator cache fidelity', () => {
    it('preserves sharedEntries across diverse instances and component evaluation orders', () => {
      StyleDeduplicator.resetCache();

      const sharedCssA = '/* @lit-core/css-fuse */ :host { --theme-primary: #0f62fe; display: block; box-sizing: border-box; }';
      const sharedCssB = '/* @lit-core/css-fuse */ :host([disabled]) { opacity: 0.5; pointer-events: none; }';
      const localCss1 = ':host { color: red; }';
      const localCss2 = ':host { color: blue; }';

      class WidgetOne extends HTMLElementStub {
        static styles = [sharedCssA, sharedCssB, localCss1];
      }

      class WidgetTwo extends HTMLElementStub {
        static styles = [sharedCssB, localCss2];
      }

      // Instance 1: Initial cold evaluation
      const dedup1 = new StyleDeduplicator();
      const res1_A = dedup1.processComponentStyles(WidgetOne);
      expect(res1_A.sharedSheets).toEqual([sharedCssA, sharedCssB]);
      expect(res1_A.localStyles).toEqual([localCss1]);
      expect(res1_A.sharedEntries?.length).toBe(2);

      const res1_B = dedup1.processComponentStyles(WidgetTwo);
      expect(res1_B.sharedSheets).toEqual([sharedCssB]);
      expect(res1_B.localStyles).toEqual([localCss2]);
      // WidgetOne already registered sharedCssB, so dedup1 should only contain sharedCssA and sharedCssB once
      expect(dedup1.getCollectedStyles()).toEqual([sharedCssA, sharedCssB]);

      // Instance 2: Warm cache evaluation in REVERSE component order
      const dedup2 = new StyleDeduplicator();
      const res2_B = dedup2.processComponentStyles(WidgetTwo);
      // Cache hit on WidgetTwo: must populate dedup2 with sharedCssB!
      expect(dedup2.getCollectedStyles()).toEqual([sharedCssB]);
      expect(res2_B.sharedSheets).toEqual([sharedCssB]);
      expect(res2_B.localStyles).toEqual([localCss2]);

      const res2_A = dedup2.processComponentStyles(WidgetOne);
      // Cache hit on WidgetOne: must populate dedup2 with sharedCssA (and NOT duplicate sharedCssB)
      expect(dedup2.getCollectedStyles()).toEqual([sharedCssB, sharedCssA]);
      expect(res2_A.sharedSheets).toEqual([sharedCssA, sharedCssB]);
      expect(res2_A.localStyles).toEqual([localCss1]);
    });

    it('correctly deduplicates constructable style objects with _fusedId', () => {
      StyleDeduplicator.resetCache();

      const fusedSheet1 = {
        _fusedId: 'fused-sheet-alpha',
        cssText: ':host { --btn-radius: 4px; padding: 8px 16px; }',
      };
      const fusedSheet2 = {
        _fusedId: 'fused-sheet-beta',
        cssText: ':host { --btn-font: "IBM Plex Sans", sans-serif; }',
      };

      class ComponentAlpha extends HTMLElementStub {
        static styles = [fusedSheet1, fusedSheet2, ':host { background: black; }'];
      }

      class ComponentBeta extends HTMLElementStub {
        static styles = [fusedSheet1, ':host { background: white; }'];
      }

      const dedup1 = new StyleDeduplicator();
      dedup1.processComponentStyles(ComponentAlpha);
      dedup1.processComponentStyles(ComponentBeta);

      expect(dedup1.getCollectedStyles()).toHaveLength(2);
      expect(dedup1.getCollectedStyles()).toContain(fusedSheet1.cssText);
      expect(dedup1.getCollectedStyles()).toContain(fusedSheet2.cssText);

      // Verify second deduplicator gets both via cache hits
      const dedup2 = new StyleDeduplicator();
      dedup2.processComponentStyles(ComponentBeta);
      expect(dedup2.getCollectedStyles()).toHaveLength(1);
      expect(dedup2.getCollectedStyles()[0]).toBe(fusedSheet1.cssText);

      dedup2.processComponentStyles(ComponentAlpha);
      expect(dedup2.getCollectedStyles()).toHaveLength(2);
      expect(dedup2.getCollectedStyles()).toContain(fusedSheet1.cssText);
      expect(dedup2.getCollectedStyles()).toContain(fusedSheet2.cssText);
    });

    it('handles nested style arrays and inherited styles safely', () => {
      StyleDeduplicator.resetCache();

      const baseCss = '/* @lit-core/css-fuse */ :host { display: inline-block; }';
      const middleCss = '/* @lit-core/css-fuse */ :host { position: relative; }';
      const leafCss = ':host { z-index: 10; }';

      class BaseComp extends HTMLElementStub {
        static styles = [baseCss];
      }

      class MiddleComp extends BaseComp {
        static styles = [BaseComp.styles, middleCss];
      }

      class LeafComp extends MiddleComp {
        static styles = [MiddleComp.styles, leafCss];
      }

      const dedup = new StyleDeduplicator();
      const res = dedup.processComponentStyles(LeafComp);

      expect(res.sharedSheets).toEqual([baseCss, middleCss]);
      expect(res.localStyles).toEqual([leafCss]);
      expect(dedup.getCollectedStyles()).toEqual([baseCss, middleCss]);
    });

    it('safely handles empty, null, and malformed styles', () => {
      StyleDeduplicator.resetCache();
      const dedup = new StyleDeduplicator();

      class EmptyComp extends HTMLElementStub {
        static styles = [];
      }

      class NullComp extends HTMLElementStub {
        static styles = [null, undefined, '', '   '];
      }

      class NoStylesComp extends HTMLElementStub {}

      expect(dedup.processComponentStyles(EmptyComp).sharedSheets).toEqual([]);
      expect(dedup.processComponentStyles(EmptyComp).localStyles).toEqual([]);

      expect(dedup.processComponentStyles(NullComp).sharedSheets).toEqual([]);
      expect(dedup.processComponentStyles(NullComp).localStyles).toEqual([]);

      expect(dedup.processComponentStyles(NoStylesComp).sharedSheets).toEqual([]);
      expect(dedup.processComponentStyles(NoStylesComp).localStyles).toEqual([]);

      // Non-constructor calls
      expect(dedup.processComponentStyles(null).sharedSheets).toEqual([]);
      expect(dedup.processComponentStyles(undefined).sharedSheets).toEqual([]);
    });

    it('resets cache completely when StyleDeduplicator.resetCache() is invoked', () => {
      StyleDeduplicator.resetCache();

      class ResetComp extends HTMLElementStub {
        static styles = ['/* @lit-core/css-fuse */ :host { color: green; }'];
      }

      const d1 = new StyleDeduplicator();
      d1.processComponentStyles(ResetComp);

      StyleDeduplicator.resetCache();

      // Now mutate the component styles to verify it re-evaluates fresh
      ResetComp.styles = ['/* @lit-core/css-fuse */ :host { color: purple; }'];
      const d2 = new StyleDeduplicator();
      const res = d2.processComponentStyles(ResetComp);

      expect(res.sharedSheets).toEqual(['/* @lit-core/css-fuse */ :host { color: purple; }']);
      expect(d2.getCollectedStyles()).toEqual(['/* @lit-core/css-fuse */ :host { color: purple; }']);
    });
  });

  describe('concurrency and isolation stress testing', () => {
    it('executes 500 concurrent streaming renders without crosstalk', async () => {
      const concurrentTasks = Array.from({ length: 500 }, (_, i) => {
        const tpl = html`<div class="item" data-id="${i}"><span>Label ${i}</span></div>`;
        return collectResult(renderToStream(tpl)).then((res) => {
          expect(res).toContain(`data-id="${i}"`);
          expect(res).toContain(`Label ${i}`);
          expect(res).not.toContain('<!--lit-part-->');
        });
      });

      await Promise.all(concurrentTasks);
    });

    it('preserves isolate environment invariants and document stubs', () => {
      const env = createIsolateEnvironment();
      expect(env.HTMLElement).toBeDefined();
      expect(env.customElements).toBeDefined();
      expect((env as any).document).toBeDefined();
      expect((env as any).document).toBe(defaultDocumentStub);
      expect((env as any).Document).toBe(DocumentStub);

      // Verify KeyboardEvent methods
      const keyEvt = new KeyboardEventStub('keydown', { key: 'Enter', cancelable: true });
      expect(keyEvt.defaultPrevented).toBe(false);
      keyEvt.preventDefault();
      expect(keyEvt.defaultPrevented).toBe(true);
      expect(keyEvt.key).toBe('Enter');

      // Verify referential equality of ownerDocument on elements
      const el = new env.HTMLElement();
      expect(el.ownerDocument).toBe(defaultDocumentStub);
      expect(el.ownerDocument).toBe(el.ownerDocument);
    });

    it('strictly guarantees 0 comment markers across all renders', async () => {
      const tpl = html`
        <main>
          <h1>Test</h1>
          <p>${'A dynamic paragraph'}</p>
          <ul>
            ${[1, 2, 3].map((n) => html`<li>Item ${n}</li>`)}
          </ul>
        </main>
      `;

      const output = await collectResult(renderToStream(tpl));
      expect(output).not.toContain('<!--lit-part');
      expect(output).not.toContain('<!--/lit-part');
      expect(output).not.toContain('<!--?lit');
      expect(output).not.toContain('<!--lit-node');
    });
  });
});
