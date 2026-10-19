import { isSerializableValue, serializeComponentState, serializeStateToJson } from '@lit-core/resumable/server';
import { createIsolateEnvironment, HTMLElementStub, renderToString } from '@lit-core/ssr';
import { escapeUnclosedTemplateTags } from '@lit-core/ssr/slot';
import { html } from 'lit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getTestBrowser } from '../harness.js';

describe('tier 5 challenger empirical stress suite for @lit-core/ssr', () => {
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
  // 1. ADVERSARIAL TEMPLATE BREAKOUT ESCAPING IN REAL CHROMIUM
  // =========================================================================
  describe('adversarial template breakout escaping', () => {
    it('escapes case variants of unclosed template closing tags', () => {
      const variants = ['</template>', '</TEMPLATE>', '</Template>', '</tEmPlAtE>', '</TEMPLATE >', '</TEMPLATE   >', '</template\n>', '</template\t>'];

      for (const variant of variants) {
        const input = `<div>Safe prefix${variant}<div id="payload">Breakout</div></div>`;
        const escaped = escapeUnclosedTemplateTags(input);
        expect(escaped).not.toMatch(/<\/template[\s>]/i);
        expect(escaped).toContain('&lt;/template&gt;');
        expect(escaped).toContain('Safe prefix');
        expect(escaped).toContain('<div id="payload">Breakout</div>');
      }
    });

    it('does NOT mangle hyphenated custom element tags matching template-*', () => {
      const hyphenatedSamples = [
        '<template-item id="item1">Content</template-item>',
        '<template-card class="active">Card Body</template-card>',
        '<template-element-viewer data-test="true"></template-element-viewer>',
        '<template-container><template-sub-item>Nested</template-sub-item></template-container>',
      ];

      for (const sample of hyphenatedSamples) {
        const escaped = escapeUnclosedTemplateTags(sample);
        expect(escaped).toBe(sample);
      }
    });

    it('preserves hyphenated custom element tags even when adjacent to unclosed </TEMPLATE>', () => {
      const mixed = '<template-item>First</template-item></TEMPLATE><template-card>Second</template-card>';
      const escaped = escapeUnclosedTemplateTags(mixed);

      expect(escaped).toBe('<template-item>First</template-item>&lt;/template&gt;<template-card>Second</template-card>');
    });

    it('preserves legitimate balanced nested <template>...</template> across case variations', () => {
      const balancedSamples = [
        '<template id="t1"><p>Inner text</p></template>',
        '<TEMPLATE id="t2"><span>Upper inner</span></TEMPLATE>',
        '<Template id="t3"><div>Mixed inner</div></Template>',
        '<template><template id="t-deep"><span>Double nested</span></template></template>',
      ];

      for (const sample of balancedSamples) {
        const result = escapeUnclosedTemplateTags(sample);
        // Legitimate balanced templates must not have their closing tags escaped
        expect(result).not.toContain('&lt;/template&gt;');
        expect(result).toBe(sample);
      }
    });

    it('verifies real Chromium does NOT prematurely terminate shadow root with case-variant breakouts', async () => {
      const cases = [
        { name: 'all-caps', tag: '</TEMPLATE>', id: 'breakout-all-caps' },
        { name: 'mixed-title', tag: '</Template>', id: 'breakout-mixed-title' },
        { name: 'mixed-random', tag: '</tEmPlAtE>', id: 'breakout-mixed-random' },
        { name: 'with-trailing-spaces', tag: '</TEMPLATE   >', id: 'breakout-spaces' },
      ];

      for (const tc of cases) {
        const descriptor = {
          tagName: `stress-test-${tc.name}`,
          shadowHtml: `<section class="shadow-inner"><span id="pre-${tc.name}">Before</span>${tc.tag}<div id="${tc.id}">Hostile Payload</div><span id="post-${tc.name}">After</span></section>`,
        };

        const rendered = renderToString(descriptor);
        expect(rendered).toContain('<template shadowrootmode="open">');
        expect(rendered).toContain('&lt;/template&gt;');

        await page.setContent(`<!DOCTYPE html><html><body><div id="mount">${rendered}</div></body></html>`);

        const domReport = await page.evaluate(
          (args: { tagName: string; payloadId: string }) => {
            const host = document.querySelector(args.tagName);
            const shadowRoot = host?.shadowRoot;
            const payloadInLight = document.getElementById(args.payloadId);
            const payloadInShadow = shadowRoot?.getElementById(args.payloadId);

            return {
              hasShadowRoot: Boolean(shadowRoot),
              breakoutInLightDom: Boolean(payloadInLight),
              payloadInShadowRoot: Boolean(payloadInShadow),
              shadowChildCount: shadowRoot?.children.length ?? 0,
            };
          },
          { tagName: descriptor.tagName, payloadId: tc.id },
        );

        expect(domReport.hasShadowRoot).toBe(true);
        expect(domReport.breakoutInLightDom).toBe(false);
        expect(domReport.payloadInShadowRoot).toBe(true);
        expect(domReport.shadowChildCount).toBeGreaterThan(0);
      }
    });

    it('verifies real Chromium renders hyphenated custom elements correctly inside Declarative Shadow DOM', async () => {
      const descriptor = {
        tagName: 'hyphen-host-box',
        shadowHtml: '<div class="shadow-wrap"><template-card id="inner-card"><span class="card-label">Card Label</span></template-card></div>',
      };

      const rendered = renderToString(descriptor);
      expect(rendered).toContain('<template shadowrootmode="open">');
      expect(rendered).toContain('<template-card id="inner-card">');
      expect(rendered).not.toContain('&lt;/template');

      await page.setContent(`<!DOCTYPE html><html><body><div id="mount">${rendered}</div></body></html>`);

      const report = await page.evaluate(() => {
        const host = document.querySelector('hyphen-host-box');
        const shadowRoot = host?.shadowRoot;
        const innerCard = shadowRoot?.querySelector('template-card');
        const cardLabel = innerCard?.querySelector('.card-label');

        return {
          hasShadowRoot: Boolean(shadowRoot),
          innerCardExists: Boolean(innerCard),
          innerCardTag: innerCard?.tagName.toLowerCase() ?? null,
          cardLabelText: cardLabel?.textContent ?? null,
        };
      });

      expect(report.hasShadowRoot).toBe(true);
      expect(report.innerCardExists).toBe(true);
      expect(report.innerCardTag).toBe('template-card');
      expect(report.cardLabelText).toBe('Card Label');
    });
  });

  // =========================================================================
  // 2. ADVERSARIAL CIRCULAR STATE SERIALIZATION
  // =========================================================================
  describe('adversarial circular state serialization', () => {
    it('handles deep cyclic object graphs without stack overflow in isSerializableValue and serializeStateToJson', () => {
      // Build a 100-node circular linked graph
      const root: any = { id: 0 };
      let current = root;
      for (let i = 1; i <= 100; i++) {
        current.next = { id: i };
        current = current.next;
      }
      current.next = root; // 100-node cycle back to root

      expect(isSerializableValue(root)).toBe(false);

      const json = serializeStateToJson(root);
      expect(json).toBeDefined();
      expect(typeof json).toBe('string');
      // Root serialized cleanly, cycle omitted
      const parsed = JSON.parse(json);
      expect(parsed.id).toBe(0);
    });

    it('handles self-referential arrays and nested cyclic arrays', () => {
      const arr: any[] = [1, 2, 3];
      arr.push(arr);
      expect(isSerializableValue(arr)).toBe(false);

      // Mutual cyclic arrays
      const arr1: any[] = ['a'];
      const arr2: any[] = ['b'];
      arr1.push(arr2);
      arr2.push(arr1);
      expect(isSerializableValue(arr1)).toBe(false);
      expect(isSerializableValue(arr2)).toBe(false);

      const container = { arr1, arr2 };
      const serialized = serializeStateToJson(container);
      expect(serialized).toBeDefined();
      const parsed = JSON.parse(serialized);
      expect(parsed.arr1[0]).toBe('a');
      expect(parsed.arr1[1][0]).toBe('b');
      expect(parsed.arr2).toBeUndefined();
    });

    it('handles cyclic array embedded in custom element state without crashing renderToString', () => {
      const cycleArray: any[] = ['element'];
      cycleArray.push(cycleArray);

      const output = renderToString(
        {
          tagName: 'cyclic-array-box',
          state: { items: cycleArray, title: 'Safe Title' },
        },
        { resumable: true },
      );

      expect(output).toContain('<cyclic-array-box>');
      expect(output).toContain('<script type="lit/state">');
      expect(output).toContain('"title":"Safe Title"');
    });

    it('operates safely when Node is undefined in pure V8 isolate environment', () => {
      // Temporarily delete Node if defined
      const originalNode = (globalThis as any).Node;
      try {
        delete (globalThis as any).Node;
        expect((globalThis as any).Node).toBeUndefined();

        // 1. isSerializableValue with primitives, plain objects, and arrays
        expect(isSerializableValue(null)).toBe(true);
        expect(isSerializableValue(123)).toBe(true);
        expect(isSerializableValue('hello')).toBe(true);
        expect(isSerializableValue({ key: 'val', nested: [1, 2] })).toBe(true);

        // 2. Circular reference check without Node
        const cyclic: any = { a: 1 };
        cyclic.self = cyclic;
        expect(isSerializableValue(cyclic)).toBe(false);

        // 3. serializeComponentState without Node
        const state = { count: 42, active: true };
        const json = serializeComponentState(state);
        expect(json).toBe('{"count":42,"active":true}');

        // 4. serializeStateToJson with cycle without Node
        const cyclicState: any = { root: true };
        cyclicState.cycle = cyclicState;
        const serialized = serializeStateToJson(cyclicState);
        expect(serialized).toContain('"root":true');
        expect(serialized).not.toContain('Converting circular structure');
      } finally {
        if (originalNode !== undefined) {
          (globalThis as any).Node = originalNode;
        }
      }
    });

    it('verifies custom element dynamic attributes emit Declarative Shadow DOM and reflect properties', () => {
      const env = createIsolateEnvironment();

      class ReflectedElement extends HTMLElementStub {
        title = '';
        active = false;
        count = 0;

        render() {
          return html`<div class="content"><p id="title">${this.title}</p><span id="count">${this.count}</span><slot></slot></div>`;
        }
      }

      env.customElements.define('reflected-elem', ReflectedElement);

      const dynTitle = 'Dynamic Title';
      const dynCount = 99;

      const tpl = html`<reflected-elem .title=${dynTitle} .count=${dynCount} ?active=${true}><span>Child</span></reflected-elem>`;
      const output = renderToString(tpl, { customElements: env.customElements });

      expect(output).toContain('<reflected-elem');
      expect(output).toContain('<template shadowrootmode="open">');
      expect(output).toContain('<p id="title">Dynamic Title</p>');
      expect(output).toContain('<span id="count">99</span>');
      expect(output).not.toContain('.count=');
      expect(output).not.toContain('?active=');
      expect(output).toContain('<span>Child</span>');
      expect(output).toContain('</template>');
      expect(output).toContain('</reflected-elem>');
    });
  });
});
