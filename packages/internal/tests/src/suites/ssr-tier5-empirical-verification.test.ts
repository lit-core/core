import { isSerializableValue, serializeComponentState, serializeStateToJson } from '@lit-core/resumable/server';
import { createIsolateEnvironment, HTMLElementStub, renderToString } from '@lit-core/ssr';
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
    it('escapes case variants of unclosed template closing tags in dynamic template expressions', () => {
      const variants = ['</template>', '</TEMPLATE>', '</Template>', '</tEmPlAtE>', '</TEMPLATE >', '</TEMPLATE   >', '</template\n>', '</template\t>'];

      for (const variant of variants) {
        const tpl = html`<div>Safe prefix${variant}<div id="payload">Breakout</div></div>`;
        const rendered = renderToString(tpl);
        expect(rendered).not.toMatch(/<\/template[\s>]/i);
        expect(rendered).toMatch(/&lt;\/template[\s\S]*?&gt;/i);
        expect(rendered).toContain('Safe prefix');
        expect(rendered).toContain('<div id="payload">Breakout</div>');
      }
    });

    it('does not mangle hyphenated custom element tags matching template-* in templates', () => {
      const samples = [
        html`<template-item id="item1">Content</template-item>`,
        html`<template-card class="active">Card Body</template-card>`,
        html`<template-element-viewer data-test="true"></template-element-viewer>`,
        html`<template-container><template-sub-item>Nested</template-sub-item></template-container>`,
      ];
      const expected = [
        '<template-item id="item1">Content</template-item>',
        '<template-card class="active">Card Body</template-card>',
        '<template-element-viewer data-test="true"></template-element-viewer>',
        '<template-container><template-sub-item>Nested</template-sub-item></template-container>',
      ];

      for (let i = 0; i < samples.length; i++) {
        const rendered = renderToString(samples[i]);
        expect(rendered).toBe(expected[i]);
      }
    });

    it('preserves hyphenated custom element tags even when adjacent to unclosed </TEMPLATE>', () => {
      const hostile = '</TEMPLATE>';
      const tpl = html`<template-item>First</template-item>${hostile}<template-card>Second</template-card>`;
      const rendered = renderToString(tpl);

      expect(rendered).toContain('<template-item>First</template-item>');
      expect(rendered).toMatch(/&lt;\/TEMPLATE&gt;/i);
      expect(rendered).toContain('<template-card>Second</template-card>');
      expect(rendered).not.toMatch(/<\/template[\s>]/i);
    });

    it('preserves legitimate balanced nested <template>...</template> across case variations', () => {
      const samples = [
        html`<template id="t1"><p>Inner text</p></template>`,
        html`<TEMPLATE id="t2"><span>Upper inner</span></TEMPLATE>`,
        html`<Template id="t3"><div>Mixed inner</div></Template>`,
        html`<template><template id="t-deep"><span>Double nested</span></template></template>`,
      ];

      for (const sample of samples) {
        const rendered = renderToString(sample);
        // Legitimate balanced templates must not have their closing tags escaped
        expect(rendered).not.toMatch(/&lt;\/template&gt;/i);
        expect(rendered).toMatch(/<template[\s>]/i);
        expect(rendered).toMatch(/<\/template>/i);
      }
    });

    it('verifies real Chromium does not prematurely terminate shadow root with case-variant breakouts', async () => {
      const env = createIsolateEnvironment();

      class AllCapsElement extends HTMLElementStub {
        tag = '</TEMPLATE>';
        render() {
          return html`<section class="shadow-inner"><span id="pre-all-caps">Before</span>${this.tag}<div id="breakout-all-caps">Hostile Payload</div><span id="post-all-caps">After</span></section>`;
        }
      }
      class MixedTitleElement extends HTMLElementStub {
        tag = '</Template>';
        render() {
          return html`<section class="shadow-inner"><span id="pre-mixed-title">Before</span>${this.tag}<div id="breakout-mixed-title">Hostile Payload</div><span id="post-mixed-title">After</span></section>`;
        }
      }
      class MixedRandomElement extends HTMLElementStub {
        tag = '</tEmPlAtE>';
        render() {
          return html`<section class="shadow-inner"><span id="pre-mixed-random">Before</span>${this.tag}<div id="breakout-mixed-random">Hostile Payload</div><span id="post-mixed-random">After</span></section>`;
        }
      }
      class TrailingSpacesElement extends HTMLElementStub {
        tag = '</TEMPLATE   >';
        render() {
          return html`<section class="shadow-inner"><span id="pre-with-trailing-spaces">Before</span>${this.tag}<div id="breakout-spaces">Hostile Payload</div><span id="post-with-trailing-spaces">After</span></section>`;
        }
      }

      env.customElements.define('stress-test-all-caps', AllCapsElement);
      env.customElements.define('stress-test-mixed-title', MixedTitleElement);
      env.customElements.define('stress-test-mixed-random', MixedRandomElement);
      env.customElements.define('stress-test-with-trailing-spaces', TrailingSpacesElement);

      const cases = [
        { tagName: 'stress-test-all-caps', tpl: html`<stress-test-all-caps></stress-test-all-caps>`, id: 'breakout-all-caps' },
        { tagName: 'stress-test-mixed-title', tpl: html`<stress-test-mixed-title></stress-test-mixed-title>`, id: 'breakout-mixed-title' },
        { tagName: 'stress-test-mixed-random', tpl: html`<stress-test-mixed-random></stress-test-mixed-random>`, id: 'breakout-mixed-random' },
        { tagName: 'stress-test-with-trailing-spaces', tpl: html`<stress-test-with-trailing-spaces></stress-test-with-trailing-spaces>`, id: 'breakout-spaces' },
      ];

      for (const tc of cases) {
        const rendered = renderToString(tc.tpl, { customElements: env.customElements });
        expect(rendered).toContain('<template shadowrootmode="open">');
        expect(rendered).toMatch(/&lt;\/template[\s\S]*?&gt;/i);

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
          { tagName: tc.tagName, payloadId: tc.id },
        );

        expect(domReport.hasShadowRoot).toBe(true);
        expect(domReport.breakoutInLightDom).toBe(false);
        expect(domReport.payloadInShadowRoot).toBe(true);
        expect(domReport.shadowChildCount).toBeGreaterThan(0);
      }
    });

    it('verifies real Chromium renders hyphenated custom elements correctly inside Declarative Shadow DOM', async () => {
      const env = createIsolateEnvironment();
      class HyphenHostBox extends HTMLElementStub {
        render() {
          return html`<div class="shadow-wrap"><template-card id="inner-card"><span class="card-label">Card Label</span></template-card></div>`;
        }
      }
      env.customElements.define('hyphen-host-box', HyphenHostBox);

      const rendered = renderToString(html`<hyphen-host-box></hyphen-host-box>`, { customElements: env.customElements });
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

      const env = createIsolateEnvironment();
      class CyclicArrayBox extends HTMLElementStub {
        render() {
          return html`<div>cyclic</div>`;
        }
      }
      env.customElements.define('cyclic-array-box', CyclicArrayBox);

      const output = renderToString(html`<cyclic-array-box></cyclic-array-box>`, {
        customElements: env.customElements,
        resumable: true,
        state: { items: cycleArray, title: 'Safe Title' },
      });

      expect(output).toContain('<cyclic-array-box ');
      expect(output).toContain('data-lit-state="');
      expect(output).not.toContain('<script type="lit/state">');
      expect(output).toContain('&quot;title&quot;:&quot;Safe Title&quot;');
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
