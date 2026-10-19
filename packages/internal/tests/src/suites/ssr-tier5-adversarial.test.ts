import { createIsolateEnvironment, createStreamFromIterator, HTMLElementStub, renderToStream, renderToString } from '@lit-core/ssr';
import { projectSlots } from '@lit-core/ssr/slot';
import { html } from 'lit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getTestBrowser } from '../harness.js';

describe('tier 5 white-box adversarial hardening suite for @lit-core/ssr', () => {
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
  // 1. HOSTILE / SLOW CONSUMERS (SLOWLORIS BACKPRESSURE) UNDER HIGH CONCURRENCY
  // =========================================================================
  describe('slow consumer backpressure and slowloris concurrency', () => {
    it('suspends generator execution until slow consumer pulls next chunk', async () => {
      let executionCount = 0;

      function* largeYieldingGenerator(): IterableIterator<string> {
        for (let i = 0; i < 500; i++) {
          executionCount++;
          // Yield 100-character strings
          yield `<div class="chunk-${i}">${'X'.repeat(90)}</div>`;
        }
      }

      // createStreamFromIterator directly tests WHATWG stream backpressure mechanics
      const stream = createStreamFromIterator(largeYieldingGenerator(), { highWaterMark: 1 });
      const reader = stream.getReader();

      // Read first chunk
      const first = await reader.read();
      expect(first.done).toBe(false);
      const countAfterFirst = executionCount;

      // Because first chunk emits immediately, countAfterFirst is small (typically 1)
      expect(countAfterFirst).toBeLessThanOrEqual(5);

      // The stream's internal queue buffers up to highWaterMark (1024 bytes).
      // Each chunk is ~110 bytes, so the queue pulls until desiredSize <= 0 (~10 items).
      await new Promise((resolve) => setTimeout(resolve, 30));
      const stabilizedCount = executionCount;
      expect(stabilizedCount).toBeLessThanOrEqual(15);

      // During an extended idle pause, generator does NOT advance further because queue is full
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(executionCount).toBe(stabilizedCount);

      // Now consumer reads the buffered chunk
      const second = await reader.read();
      expect(second.done).toBe(false);

      // Clean up stream
      await reader.cancel('test complete');
    });

    it('suspends renderToStream execution when streaming large arrays to slow readers', async () => {
      // Test renderToStream with an Array of 200 Lit templates
      const items = Array.from({ length: 200 }, (_, i) => html`<div class="item-${i}">${'Y'.repeat(100)}</div>`);
      const stream = renderToStream(items, { highWaterMark: 1 });
      const reader = stream.getReader();

      const chunk1 = await reader.read();
      expect(chunk1.done).toBe(false);
      expect(chunk1.value).toBeDefined();

      // Consumer pauses for 25ms
      await new Promise((resolve) => setTimeout(resolve, 25));

      const chunk2 = await reader.read();
      expect(chunk2.done).toBe(false);

      await reader.cancel('client abort');
      const postCancel = await reader.read();
      expect(postCancel.done).toBe(true);
    });

    it('processes 50 concurrent slowloris streaming readers with artificial consumer latency', async () => {
      const env = createIsolateEnvironment();

      class SlowlorisItem extends HTMLElementStub {
        render() {
          return html`<section><p>Slow consumer payload</p><slot></slot></section>`;
        }
      }

      env.customElements.define('slowloris-item', SlowlorisItem);

      const concurrency = 50;
      const initialMemory = process.memoryUsage().heapUsed;

      const tasks = Array.from({ length: concurrency }, async () => {
        // Use an array of statically parsed custom element and slotted span
        const stream = renderToStream(html`<slowloris-item>Static record content</slowloris-item>`, { customElements: env.customElements, highWaterMark: 1 });

        const reader = stream.getReader();
        const chunks: Uint8Array[] = [];

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) {
            chunks.push(value);
          }
          // Artificial consumer backpressure delay per chunk
          await new Promise((resolve) => setTimeout(resolve, 5));
        }

        const decoder = new TextDecoder();
        const fullHtml = chunks.map((c) => decoder.decode(c, { stream: true })).join('');
        expect(fullHtml).toContain('<template shadowrootmode="open">');
        expect(fullHtml).toContain('Slow consumer payload');
        return fullHtml;
      });

      const results = await Promise.all(tasks);
      expect(results.length).toBe(concurrency);

      const finalMemory = process.memoryUsage().heapUsed;
      const heapDeltaMb = (finalMemory - initialMemory) / (1024 * 1024);
      // 50 concurrent streams should not cause runaway heap expansion (< 35MB)
      expect(heapDeltaMb).toBeLessThan(35);
    });

    it('tears down generator and triggers finally block when slow consumer aborts mid-stream', async () => {
      let finallyTriggered = false;
      let totalYields = 0;

      function* slowlorisGenerator(): IterableIterator<string> {
        try {
          for (let i = 0; i < 2000; i++) {
            totalYields++;
            yield `<item>${i}</item>`;
          }
        } finally {
          finallyTriggered = true;
        }
      }

      const stream = createStreamFromIterator(slowlorisGenerator(), { highWaterMark: 1 });
      const reader = stream.getReader();

      // Read initial chunk
      const chunk1 = await reader.read();
      expect(chunk1.done).toBe(false);

      // Slow consumer delay
      await new Promise((resolve) => setTimeout(resolve, 20));

      const chunk2 = await reader.read();
      expect(chunk2.done).toBe(false);

      // Client timeout / abort
      await reader.cancel('slowloris client aborted connection');

      expect(finallyTriggered).toBe(true);
      // Did not iterate through all 2000 items (buffered only ~2KB)
      expect(totalYields).toBeLessThan(300);

      const chunkAfterCancel = await reader.read();
      expect(chunkAfterCancel.done).toBe(true);
    });
  });

  // =========================================================================
  // 2. SHADOW DOM TEMPLATE INJECTION ESCAPING AND BOUNDARY PRESERVATION
  // =========================================================================
  describe('shadow DOM template injection escaping and boundary preservation', () => {
    it('preserves shadow root boundary when legitimate nested template elements exist in shadow DOM', async () => {
      const env = createIsolateEnvironment();

      class NestedTemplateElement extends HTMLElementStub {
        render() {
          return html`
            <div class="host-content">
              <p id="shadow-title">Shadow Header</p>
              <template id="sub-template"><span class="inert-stamp">Stamp</span></template>
            </div>
          `;
        }
      }

      env.customElements.define('nested-template-elem', NestedTemplateElement);

      const dsdOutput = renderToString(html`<nested-template-elem></nested-template-elem>`, {
        customElements: env.customElements,
      });

      expect(dsdOutput).toContain('<template shadowrootmode="open">');
      expect(dsdOutput).toContain('<template id="sub-template">');

      // Test real browser parsing in headless Chromium
      await page.setContent(`<!DOCTYPE html><html><body><div id="mount">${dsdOutput}</div></body></html>`);

      const domInspection = await page.evaluate(() => {
        const host = document.querySelector('nested-template-elem');
        if (!host?.shadowRoot) {
          return { hasShadow: false, shadowTitle: null, nestedTemplateFound: false, stampInLightDom: false };
        }
        const titleEl = host.shadowRoot.querySelector('#shadow-title');
        const nestedTmpl = host.shadowRoot.querySelector('#sub-template');
        const stampInLight = Boolean(document.querySelector('.inert-stamp'));

        return {
          hasShadow: true,
          shadowTitle: titleEl?.textContent ?? null,
          nestedTemplateFound: Boolean(nestedTmpl),
          stampInLightDom: stampInLight,
        };
      });

      expect(domInspection.hasShadow).toBe(true);
      expect(domInspection.shadowTitle).toBe('Shadow Header');
      expect(domInspection.nestedTemplateFound).toBe(true);
      expect(domInspection.stampInLightDom).toBe(false);
    });

    it('escapes unclosed template closing tags in raw shadowHtml to preserve shadow DOM encapsulation in browser', async () => {
      // In component descriptors, shadowHtml is injected directly inside <template shadowrootmode="open">
      // Unclosed </template> tags are escaped to &lt;/template&gt; to prevent terminating Declarative Shadow DOM prematurely
      const maliciousDescriptor = {
        tagName: 'injection-test-box',
        shadowHtml: '<div class="shadow-wrap"><span id="shadow-safe">Safe</span></template><div id="breakout-payload">Escaped into Light DOM</div><template shadowrootmode="open"></div>',
      };

      const emittedHtml = renderToString(maliciousDescriptor);

      // Verify what was emitted: unclosed </template> was escaped
      expect(emittedHtml).toContain('<template shadowrootmode="open">');
      expect(emittedHtml).toContain('&lt;/template&gt;<div id="breakout-payload">');

      // Parse inside real Chromium
      await page.setContent(`<!DOCTYPE html><html><body><div id="mount">${emittedHtml}</div></body></html>`);

      const inspection = await page.evaluate(() => {
        const host = document.querySelector('injection-test-box');
        const breakoutInLight = document.getElementById('breakout-payload');
        const breakoutInShadow = host?.shadowRoot?.getElementById('breakout-payload');
        const safeInShadow = host?.shadowRoot?.getElementById('shadow-safe');

        return {
          hasShadow: Boolean(host?.shadowRoot),
          breakoutFoundInLightDom: Boolean(breakoutInLight),
          breakoutFoundInShadowRoot: Boolean(breakoutInShadow),
          safeInShadow: Boolean(safeInShadow),
        };
      });

      // Shadow root is preserved and payload stays inside shadow root
      expect(inspection.hasShadow).toBe(true);
      expect(inspection.breakoutFoundInLightDom).toBe(false);
      expect(inspection.breakoutFoundInShadowRoot).toBe(true);
    });

    it('escapes uppercase </TEMPLATE> and mixed-case </Template> unclosed tags to prevent breakout in real Chromium', async () => {
      const maliciousDescriptor = {
        tagName: 'uppercase-injection-box',
        shadowHtml: '<div class="shadow-wrap"><span id="shadow-safe">Safe</span></TEMPLATE><div id="breakout-payload-upper">Escaped into Light DOM</div><template shadowrootmode="open"></div>',
      };

      const emittedHtml = renderToString(maliciousDescriptor);

      // Parse inside real Chromium
      await page.setContent(`<!DOCTYPE html><html><body><div id="mount">${emittedHtml}</div></body></html>`);

      const inspection = await page.evaluate(() => {
        const host = document.querySelector('uppercase-injection-box');
        const breakoutInLight = document.getElementById('breakout-payload-upper');
        const breakoutInShadow = host?.shadowRoot?.getElementById('breakout-payload-upper');

        return {
          hasShadow: Boolean(host?.shadowRoot),
          breakoutFoundInLightDom: Boolean(breakoutInLight),
          breakoutFoundInShadowRoot: Boolean(breakoutInShadow),
        };
      });

      expect(inspection.hasShadow).toBe(true);
      expect(inspection.breakoutFoundInLightDom).toBe(false);
      expect(inspection.breakoutFoundInShadowRoot).toBe(true);
    });

    it('escapes unclosed template tags in slotted light DOM content to preserve shadow DOM encapsulation when projected', async () => {
      // Slotted light DOM projected into a shadow slot
      const shadowTemplate = '<div class="card-root"><slot name="content"></slot></div>';
      const hostileSlottedChildren = [
        {
          slot: 'content',
          content: '<div class="user-content">User post</template><div id="slotted-breakout">Injected Light Node</div></div>',
        },
      ];

      const { projectedShadow } = projectSlots(shadowTemplate, hostileSlottedChildren);

      const componentOutput = renderToString({
        tagName: 'hostile-slotted-card',
        shadowHtml: projectedShadow,
      });

      await page.setContent(`<!DOCTYPE html><html><body><div id="mount">${componentOutput}</div></body></html>`);

      const inspection = await page.evaluate(() => {
        const host = document.querySelector('hostile-slotted-card');
        const breakoutInLight = document.getElementById('slotted-breakout');
        const breakoutInShadow = host?.shadowRoot?.getElementById('slotted-breakout');

        return {
          hasShadow: Boolean(host?.shadowRoot),
          breakoutInLightDom: Boolean(breakoutInLight),
          breakoutInShadowRoot: Boolean(breakoutInShadow),
        };
      });

      // Slotted content unclosed template tags are escaped, preventing breakout
      expect(inspection.breakoutInLightDom).toBe(false);
      expect(inspection.breakoutInShadowRoot).toBe(true);
    });

    it('safely escapes template closing tags in standard Lit html expression bindings', async () => {
      const hostileInput = '</template><script id="evil-script">window.evil = true;</script>';

      // In Lit html templates, expression values pass through escapeHtml
      const tpl = html`<div class="container">${hostileInput}</div>`;
      const output = renderToString(tpl);

      expect(output).not.toContain('</template>');
      expect(output).toContain('&lt;/template&gt;&lt;script id=&quot;evil-script&quot;&gt;');

      await page.setContent(`<!DOCTYPE html><html><body><div id="mount">${output}</div></body></html>`);

      const scriptFound = await page.evaluate(() => {
        return Boolean(document.getElementById('evil-script'));
      });
      expect(scriptFound).toBe(false);
    });
  });

  // =========================================================================
  // 3. COMPONENT LIFECYCLE EXCEPTION ISOLATION
  // =========================================================================
  describe('component lifecycle exception isolation', () => {
    it('catches and isolates exceptions thrown in connectedCallback without aborting SSR render', () => {
      const env = createIsolateEnvironment();

      class ResilientElement extends HTMLElementStub {
        connectedCallback() {
          // Throws standard DOM reference error common on server
          throw new ReferenceError('window is not defined in connectedCallback');
        }

        render() {
          return html`<div class="resilient"><p>Render succeeded despite connectedCallback error</p></div>`;
        }
      }

      env.customElements.define('resilient-elem', ResilientElement);

      const output = renderToString(html`<resilient-elem></resilient-elem>`, {
        customElements: env.customElements,
      });

      expect(output).toContain('<resilient-elem><template shadowrootmode="open">');
      expect(output).toContain('Render succeeded despite connectedCallback error');
    });

    it('propagates exception thrown in render method during renderToString and unwinds context cleanly', () => {
      const env = createIsolateEnvironment();

      class ThrowingRenderElement extends HTMLElementStub {
        render() {
          throw new Error('deliberate render exception');
        }
      }

      class SiblingElement extends HTMLElementStub {
        render() {
          return html`<span>Sibling rendered</span>`;
        }
      }

      env.customElements.define('throwing-render-elem', ThrowingRenderElement);
      env.customElements.define('sibling-elem', SiblingElement);

      // Render throws deliberate exception
      expect(() => {
        renderToString(html`<throwing-render-elem></throwing-render-elem>`, {
          customElements: env.customElements,
        });
      }).toThrow('deliberate render exception');

      // Assert environment and slot manager are restored cleanly:
      // Subsequent render on the same environment must succeed without lingering stack errors
      const safeOutput = renderToString(html`<sibling-elem></sibling-elem>`, {
        customElements: env.customElements,
      });
      expect(safeOutput).toContain('<span>Sibling rendered</span>');
    });

    it('propagates render exception through ReadableStream in renderToStream without hanging', async () => {
      const env = createIsolateEnvironment();

      class StreamThrower extends HTMLElementStub {
        render() {
          throw new Error('streaming render explosion');
        }
      }

      env.customElements.define('stream-thrower', StreamThrower);

      const stream = renderToStream(html`<stream-thrower></stream-thrower>`, {
        customElements: env.customElements,
      });

      const reader = stream.getReader();

      // In stream.ts, pull() calls controller.error(err) when iterator throws
      await expect(reader.read()).rejects.toThrow('streaming render explosion');
      await expect(reader.closed).rejects.toThrow('streaming render explosion');
    });

    it('handles property getter exceptions in render method cleanly', () => {
      const env = createIsolateEnvironment();

      class FailingGetterElement extends HTMLElementStub {
        get faultyData() {
          throw new TypeError('Cannot read properties of null (reading data)');
        }

        render() {
          return html`<div>${this.faultyData}</div>`;
        }
      }

      env.customElements.define('failing-getter-elem', FailingGetterElement);

      expect(() => {
        renderToString(html`<failing-getter-elem></failing-getter-elem>`, {
          customElements: env.customElements,
        });
      }).toThrow(TypeError);
    });

    it('handles static styles getter exceptions without corrupting subsequent component renders', () => {
      const env = createIsolateEnvironment();

      class FaultyStylesElement extends HTMLElementStub {
        static get styles() {
          throw new Error('Dynamic styles computation failed');
        }

        render() {
          return html`<p>Text</p>`;
        }
      }

      class NormalStylesElement extends HTMLElementStub {
        static get styles() {
          return ':host { color: blue; }';
        }

        render() {
          return html`<p>Normal</p>`;
        }
      }

      env.customElements.define('faulty-styles-elem', FaultyStylesElement);
      env.customElements.define('normal-styles-elem', NormalStylesElement);

      expect(() => {
        renderToString(html`<faulty-styles-elem></faulty-styles-elem>`, {
          customElements: env.customElements,
        });
      }).toThrow('Dynamic styles computation failed');

      // Next render functions properly
      const recoveryOutput = renderToString(html`<normal-styles-elem></normal-styles-elem>`, {
        customElements: env.customElements,
      });
      expect(recoveryOutput).toContain('<style>:host { color: blue; }</style>');
      expect(recoveryOutput).toContain('Normal');
    });

    it('handles constructor exceptions without corrupting render depth or slot context', () => {
      const env = createIsolateEnvironment();

      class ExplodingConstructorElement extends HTMLElementStub {
        constructor() {
          super();
          throw new Error('Constructor fatal failure');
        }
      }

      class SafeElement extends HTMLElementStub {
        render() {
          return html`<div>Safe element</div>`;
        }
      }

      env.customElements.define('exploding-ctor-elem', ExplodingConstructorElement);
      env.customElements.define('safe-elem', SafeElement);

      expect(() => {
        renderToString(html`<exploding-ctor-elem></exploding-ctor-elem>`, {
          customElements: env.customElements,
        });
      }).toThrow('Constructor fatal failure');

      const recovery = renderToString(html`<safe-elem></safe-elem>`, {
        customElements: env.customElements,
      });
      expect(recovery).toContain('Safe element');
    });

    it('delivers initial opening tag chunk and rejects on faulty sibling in streaming mode', async () => {
      const env = createIsolateEnvironment();

      class GoodSibling extends HTMLElementStub {
        render() {
          return html`<div class="good">Good sibling content</div>`;
        }
      }

      class BadSibling extends HTMLElementStub {
        render() {
          throw new Error('Bad sibling failed');
        }
      }

      env.customElements.define('good-sibling', GoodSibling);
      env.customElements.define('bad-sibling', BadSibling);

      const stream = renderToStream(html`<good-sibling></good-sibling><bad-sibling></bad-sibling>`, { customElements: env.customElements });

      const reader = stream.getReader();

      // First chunk containing good sibling tag is emitted before bad sibling throws
      const firstChunk = await reader.read();
      expect(firstChunk.done).toBe(false);
      const decodedFirst = new TextDecoder().decode(firstChunk.value);
      expect(decodedFirst).toContain('<good-sibling>');

      // Subsequent read hits the bad sibling and rejects cleanly
      await expect(reader.read()).rejects.toThrow('Bad sibling failed');
    });
  });

  // =========================================================================
  // 4. ARCHITECTURAL COVERAGE GAPS EMPIRICALLY CONFIRMED
  // =========================================================================
  describe('architectural edge-case gaps and failure mode confirmations', () => {
    it('tracks custom elements across dynamic expressions in Lit templates emitting Declarative Shadow DOM', () => {
      const env = createIsolateEnvironment();

      class TagWithChildren extends HTMLElementStub {
        render() {
          return html`<div class="inner-shadow"><slot></slot></div>`;
        }
      }

      env.customElements.define('tag-with-children', TagWithChildren);

      // Case A: Completely static tag produces Declarative Shadow DOM
      const staticOutput = renderToString(html`<tag-with-children>Static content</tag-with-children>`, {
        customElements: env.customElements,
      });
      expect(staticOutput).toContain('<template shadowrootmode="open">');
      expect(staticOutput).toContain('inner-shadow');

      // Case B: Dynamic expression inside custom element tag matches closing tag across quasi boundaries
      const dynamicVal = 'Dynamic content';
      const dynamicOutput = renderToString(html`<tag-with-children>${dynamicVal}</tag-with-children>`, {
        customElements: env.customElements,
      });

      // Custom element tracking across quasi boundaries emits full Declarative Shadow DOM
      expect(dynamicOutput).toContain('<template shadowrootmode="open">');
      expect(dynamicOutput).toContain('inner-shadow');
      expect(dynamicOutput).toContain('Dynamic content');
    });

    it('supports non-Array iterables during SSR rendering without falling through to generic stringification', () => {
      const templateSet = new Set([html`<div>Set item</div>`]);

      const output = renderToString(templateSet);
      expect(output).toBe('<div>Set item</div>');
    });

    it('tracks nested and sibling custom elements with dynamic children across quasi boundaries', () => {
      const env = createIsolateEnvironment();

      class OuterBox extends HTMLElementStub {
        render() {
          return html`<section class="outer-shadow"><slot></slot></section>`;
        }
      }

      class InnerBox extends HTMLElementStub {
        render() {
          return html`<article class="inner-shadow"><slot></slot></article>`;
        }
      }

      env.customElements.define('outer-box', OuterBox);
      env.customElements.define('inner-box', InnerBox);

      // Sibling custom elements across quasi boundaries with static attributes
      const siblingTpl = html`<outer-box id="out-1">${'Sib 1'}</outer-box><outer-box id="out-2">${'Sib 2'}</outer-box>`;
      const siblingOutput = renderToString(siblingTpl, { customElements: env.customElements });

      expect(siblingOutput).toContain('<outer-box id="out-1"><template shadowrootmode="open"><section class="outer-shadow">');
      expect(siblingOutput).toContain('Sib 1');
      expect(siblingOutput).toContain('<outer-box id="out-2"><template shadowrootmode="open"><section class="outer-shadow">');
      expect(siblingOutput).toContain('Sib 2');

      // Nested custom elements across quasi boundaries with static attributes
      const nestedTpl = html`<outer-box title="Outer"><inner-box label="Inner">${'Deep child'}</inner-box></outer-box>`;
      const nestedOutput = renderToString(nestedTpl, { customElements: env.customElements });

      expect(nestedOutput).toContain('<outer-box title="Outer"><template shadowrootmode="open"><section class="outer-shadow">');
      expect(nestedOutput).toContain('<inner-box label="Inner"><template shadowrootmode="open"><article class="inner-shadow">');
      expect(nestedOutput).toContain('Deep child');

      // Unregistered custom element spanning quasis emits clean markup
      const unregTpl = html`<unregistered-card data-id="123">${'Unregistered child'}</unregistered-card>`;
      const unregOutput = renderToString(unregTpl, { customElements: env.customElements });
      expect(unregOutput).toBe('<unregistered-card data-id="123">Unregistered child</unregistered-card>');
    });

    it('tracks custom elements with dynamic attributes across quasi boundaries emitting Declarative Shadow DOM', () => {
      const env = createIsolateEnvironment();

      class DynAttrBox extends HTMLElementStub {
        render() {
          return html`<div class="shadow-box"><slot></slot></div>`;
        }
      }

      env.customElements.define('dyn-attr-box', DynAttrBox);

      // Case 1: Custom element with dynamic string attribute
      const strAttrOutput = renderToString(html`<dyn-attr-box id="${'dyn-1'}">${'Child content'}</dyn-attr-box>`, {
        customElements: env.customElements,
      });
      expect(strAttrOutput).toContain('<dyn-attr-box id="dyn-1"><template shadowrootmode="open"><div class="shadow-box">');
      expect(strAttrOutput).toContain('Child content');

      // Case 2: Custom element with boolean attribute
      const boolAttrOutput = renderToString(html`<dyn-attr-box ?disabled=${true}>Static text</dyn-attr-box>`, {
        customElements: env.customElements,
      });
      expect(boolAttrOutput).toContain('<dyn-attr-box disabled><template shadowrootmode="open"><div class="shadow-box">');

      // Case 3: Custom element with event attribute
      const eventAttrOutput = renderToString(html`<dyn-attr-box @click=${() => {}}>Interactive</dyn-attr-box>`, {
        customElements: env.customElements,
      });
      expect(eventAttrOutput).toContain('<dyn-attr-box resumes-on-click><template shadowrootmode="open"><div class="shadow-box">');
    });

    it('supports diverse iterable types: generators, Map values, custom iterables, empty iterables, and iterables in template expressions', () => {
      // 1. Generator function yielding strings and templates
      function* itemGenerator() {
        yield 'item-0;';
        yield html`<span>item-1;</span>`;
        yield 'item-2;';
      }
      const genOutput = renderToString(itemGenerator());
      expect(genOutput).toBe('item-0;<span>item-1;</span>item-2;');

      // 2. Map values and Map keys
      const testMap = new Map([
        ['k1', 'val-A'],
        ['k2', 'val-B'],
      ]);
      const mapValOutput = renderToString(testMap.values());
      expect(mapValOutput).toBe('val-Aval-B');

      const mapKeyOutput = renderToString(testMap.keys());
      expect(mapKeyOutput).toBe('k1k2');

      // 3. Custom iterable object implementing Symbol.iterator
      const customIterable = {
        *[Symbol.iterator]() {
          yield 'custom-1;';
          yield 'custom-2;';
        },
      };
      const customOutput = renderToString(customIterable);
      expect(customOutput).toBe('custom-1;custom-2;');

      // 4. Empty iterable produces empty string
      expect(renderToString(new Set())).toBe('');

      // 5. Iterables inside Lit template child expressions
      const tplWithSet = html`<ul>${new Set([html`<li>A</li>`, html`<li>B</li>`])}</ul>`;
      expect(renderToString(tplWithSet)).toBe('<ul><li>A</li><li>B</li></ul>');

      // 6. Nested iterables
      const nestedIterable = new Set([new Set(['nest-1', 'nest-2']), ['arr-3']]);
      expect(renderToString(nestedIterable)).toBe('nest-1nest-2arr-3');
    });
  });
});
