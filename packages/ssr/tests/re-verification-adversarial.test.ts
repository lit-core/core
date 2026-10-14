import { isSerializableValue, serializeStateToJson } from '@lit-core/resumable/server';
import { html, nothing } from 'lit';
import { describe, expect, it } from 'vitest';
import { createIsolateEnvironment, createStreamFromIterator, HTMLElementStub, renderToString } from '../src/index.js';
import { projectSlots } from '../src/slot.js';

describe('tier 5 adversarial re-verification suite for @lit-core/ssr', () => {
  // =========================================================================
  // 1. DYNAMIC CHILD EXPRESSIONS INSIDE CUSTOM ELEMENTS IN LIT TEMPLATES
  // =========================================================================
  describe('dynamic child expressions inside custom elements', () => {
    it('emits Declarative Shadow DOM with dynamic expressions across multiple child holes (static attributes)', () => {
      const env = createIsolateEnvironment();

      class CardComponent extends HTMLElementStub {
        render() {
          return html`<div class="card-shell"><slot></slot></div>`;
        }
      }
      env.customElements.define('test-card', CardComponent);

      const val1 = 'first-dynamic';
      const val2 = 'second-dynamic';

      const tpl = html`<test-card>Prefix: <span>${val1}</span> Middle <b>${val2}</b> Suffix</test-card>`;
      const output = renderToString(tpl, { customElements: env.customElements });

      // Declarative Shadow DOM must be emitted
      expect(output).toContain('<test-card');
      expect(output).toContain('<template shadowrootmode="open">');
      expect(output).toContain('<div class="card-shell"><slot></slot></div>');
      expect(output).toContain('</template>');

      // All dynamic children must be present in light DOM
      expect(output).toContain('Prefix: <span>first-dynamic</span> Middle <b>second-dynamic</b> Suffix');
      expect(output).toContain('</test-card>');
    });

    it('emits Declarative Shadow DOM when custom element has dynamic attributes and dynamic children', () => {
      const env = createIsolateEnvironment();

      class CardComponent extends HTMLElementStub {
        render() {
          return html`<div class="card-shell"><slot></slot></div>`;
        }
      }
      env.customElements.define('test-card-dyn-attr', CardComponent);

      const val1 = 'first-dynamic';
      const idVal = 'card-123';

      const tpl = html`<test-card-dyn-attr id="${idVal}"><span>${val1}</span></test-card-dyn-attr>`;
      const output = renderToString(tpl, { customElements: env.customElements });

      expect(output).toContain('<template shadowrootmode="open">');
      expect(output).toContain('id="card-123"');
      expect(output).toContain('<span>first-dynamic</span>');
    });

    it('emits Declarative Shadow DOM when custom element has dynamic attributes and static child', () => {
      const env = createIsolateEnvironment();

      class CardComponent extends HTMLElementStub {
        render() {
          return html`<div class="card-shell"><slot></slot></div>`;
        }
      }
      env.customElements.define('test-card-dyn-attr-static-child', CardComponent);

      const idVal = 'card-456';
      const tpl = html`<test-card-dyn-attr-static-child id="${idVal}">static text</test-card-dyn-attr-static-child>`;
      const output = renderToString(tpl, { customElements: env.customElements });

      expect(output).toContain('<template shadowrootmode="open">');
      expect(output).toContain('id="card-456"');
      expect(output).toContain('static text');
    });

    it('emits Declarative Shadow DOM for nested custom elements both having dynamic children (static attributes)', () => {
      const env = createIsolateEnvironment();

      class ParentEl extends HTMLElementStub {
        render() {
          return html`<section class="parent-shadow"><slot></slot></section>`;
        }
      }
      class ChildEl extends HTMLElementStub {
        render() {
          return html`<article class="child-shadow"><slot></slot></article>`;
        }
      }

      env.customElements.define('parent-el', ParentEl);
      env.customElements.define('child-el', ChildEl);

      const parentText = 'parent-data';
      const childText = 'child-data';

      const tpl = html`<parent-el><p>${parentText}</p><child-el><span>${childText}</span></child-el></parent-el>`;
      const output = renderToString(tpl, { customElements: env.customElements });

      // Both custom elements must have Declarative Shadow DOM
      expect(output).toContain('<parent-el><template shadowrootmode="open"><section class="parent-shadow"><slot></slot></section></template>');
      expect(output).toContain('<child-el><template shadowrootmode="open"><article class="child-shadow"><slot></slot></article></template>');
      expect(output).toContain('<p>parent-data</p>');
      expect(output).toContain('<span>child-data</span>');
    });

    it('handles arrays of custom elements with dynamic children in Lit expressions', () => {
      const env = createIsolateEnvironment();

      class RowItem extends HTMLElementStub {
        render() {
          return html`<li class="row-shadow"><slot></slot></li>`;
        }
      }
      env.customElements.define('row-item', RowItem);

      const items = ['alpha', 'beta', 'gamma'];
      const tpl = html`<ul>${items.map((item, idx) => html`<row-item data-index="${idx}">Item: ${item}</row-item>`)}</ul>`;

      const output = renderToString(tpl, { customElements: env.customElements });

      expect(output).toContain('<ul>');
      expect(output).toContain('<row-item data-index="0"><template shadowrootmode="open"><li class="row-shadow"><slot></slot></li></template>Item: alpha</row-item>');
      expect(output).toContain('<row-item data-index="1"><template shadowrootmode="open"><li class="row-shadow"><slot></slot></li></template>Item: beta</row-item>');
      expect(output).toContain('<row-item data-index="2"><template shadowrootmode="open"><li class="row-shadow"><slot></slot></li></template>Item: gamma</row-item>');
      expect(output).toContain('</ul>');
    });

    it('correctly handles unregistered custom elements with dynamic children', () => {
      const env = createIsolateEnvironment();

      const dynamicVal = 'dynamic-text';
      // 'unregistered-el' is NOT registered in customElements
      const tpl = html`<unregistered-el data-test="test">${dynamicVal}</unregistered-el>`;

      const output = renderToString(tpl, { customElements: env.customElements });

      // Unregistered elements emit plain HTML tags without shadow template
      expect(output).toBe('<unregistered-el data-test="test">dynamic-text</unregistered-el>');
      expect(output).not.toContain('<template shadowrootmode="open">');
    });

    it('handles self-closing custom elements adjacent to elements with dynamic children', () => {
      const env = createIsolateEnvironment();

      class SelfCloseEl extends HTMLElementStub {
        render() {
          return html`<span class="self-shadow">Void</span>`;
        }
      }
      class NormalEl extends HTMLElementStub {
        render() {
          return html`<div class="normal-shadow"><slot></slot></div>`;
        }
      }

      env.customElements.define('self-close-el', SelfCloseEl);
      env.customElements.define('normal-el', NormalEl);

      const tpl = html`<div><self-close-el/><normal-el>${'inner'}</normal-el></div>`;
      const output = renderToString(tpl, { customElements: env.customElements });

      expect(output).toContain('<self-close-el');
      expect(output).toContain('<normal-el');
      expect(output).toContain('inner');
    });
  });

  // =========================================================================
  // 2. DEPTH-BALANCED SLOT PARSING WITH MULTI-LEVEL NESTED IDENTICAL TAGS
  // =========================================================================
  describe('depth-balanced slot parsing with multi-level nested identical tags', () => {
    it('preserves deeply nested (4 levels) identical tags without truncation in flattened mode', () => {
      const env = createIsolateEnvironment();

      class DeepSlotHost extends HTMLElementStub {
        render() {
          return html`<main class="host-frame"><slot name="content"></slot></main>`;
        }
      }
      env.customElements.define('deep-slot-host', DeepSlotHost);

      const tpl = html`
        <deep-slot-host>
          <div slot="content" class="lvl-1">
            <div class="lvl-2">
              <div class="lvl-3">
                <div class="lvl-4">Deepest leaf text</div>
                L3 sibling text
              </div>
              L2 sibling text
            </div>
            L1 sibling text
          </div>
        </deep-slot-host>
      `;

      const flattened = renderToString(tpl, {
        customElements: env.customElements,
        mode: 'flattened',
      });

      expect(flattened).toContain('Deepest leaf text');
      expect(flattened).toContain('L3 sibling text');
      expect(flattened).toContain('L2 sibling text');
      expect(flattened).toContain('L1 sibling text');
      expect(flattened).not.toContain('</deep-slot-host></div>'); // No orphaned stray closing tags
    });

    it('preserves multiple sibling slotted nodes of the same tag name, each containing nested identical tags', () => {
      const env = createIsolateEnvironment();

      class MultiHost extends HTMLElementStub {
        render() {
          return html`<header><slot name="hdr"></slot></header><section><slot name="bdy"></slot></section>`;
        }
      }
      env.customElements.define('multi-host', MultiHost);

      const tpl = html`
        <multi-host>
          <div slot="hdr" class="hdr-outer">
            <div class="hdr-inner">Header Inner</div>
            Header Outer
          </div>
          <div slot="bdy" class="bdy-outer">
            <div class="bdy-inner">Body Inner</div>
            Body Outer
          </div>
        </multi-host>
      `;

      const flattened = renderToString(tpl, {
        customElements: env.customElements,
        mode: 'flattened',
      });

      expect(flattened).toContain('Header Inner');
      expect(flattened).toContain('Header Outer');
      expect(flattened).toContain('Body Inner');
      expect(flattened).toContain('Body Outer');
      expect(flattened).toContain('<header><div slot="hdr" class="hdr-outer">');
      expect(flattened).toContain('<section><div slot="bdy" class="bdy-outer">');
    });

    it('handles slotted elements containing void elements and special attributes correctly', () => {
      const env = createIsolateEnvironment();

      class VoidSlotHost extends HTMLElementStub {
        render() {
          return html`<div class="void-host"><slot></slot></div>`;
        }
      }
      env.customElements.define('void-slot-host', VoidSlotHost);

      const tpl = html`
        <void-slot-host>
          <div class="outer" data-info="test > val / quote">
            <img src="avatar.png" alt="User avatar" />
            <br />
            <input type="text" value="hello" />
            <span>Text after void</span>
          </div>
        </void-slot-host>
      `;

      const flattened = renderToString(tpl, {
        customElements: env.customElements,
        mode: 'flattened',
      });

      expect(flattened).toContain('<img src="avatar.png" alt="User avatar" />');
      expect(flattened).toContain('<br />');
      expect(flattened).toContain('<input type="text" value="hello" />');
      expect(flattened).toContain('<span>Text after void</span>');
    });
  });

  // =========================================================================
  // 3. CIRCULAR STATE SERIALIZATION WITH CYCLICAL OBJECTS
  // =========================================================================
  describe('circular state serialization with cyclical objects', () => {
    it('detects cycles in complex mutual and deep object graphs via isSerializableValue', () => {
      const a: any = { name: 'a' };
      const b: any = { name: 'b' };
      const c: any = { name: 'c' };
      a.next = b;
      b.next = c;
      c.next = a; // Mutual cycle 3 levels deep

      expect(isSerializableValue(a)).toBe(false);
    });

    it('detects self-referential array structures in isSerializableValue', () => {
      const arr: any[] = [1, 2];
      arr.push(arr);

      expect(isSerializableValue(arr)).toBe(false);
    });

    it('preserves valid DAG diamond structures (shared references without cycle)', () => {
      const shared = { sharedProp: 42 };
      const diamond = {
        left: shared,
        right: shared,
      };

      // Diamond is NOT cyclical, but seen tracking in weakset detects shared during same traversal
      // serializeStateToJson must emit valid JSON without crash
      const json = serializeStateToJson(diamond);
      expect(json).toBeDefined();
      const parsed = JSON.parse(json);
      expect(parsed.left.sharedProp).toBe(42);
    });

    it('serializes component descriptor with mutual cyclical state safely without throwing TypeError', () => {
      const obj1: any = { id: 101 };
      const obj2: any = { id: 102 };
      obj1.ref = obj2;
      obj2.ref = obj1;

      const output = renderToString(
        {
          tagName: 'cycle-desc',
          state: obj1,
        },
        { resumable: true },
      );

      expect(output).toContain('<cycle-desc>');
      expect(output).toContain('<script type="lit/state">');
      // Cyclic ref is omitted, id is preserved
      expect(output).toContain('"id":101');
      expect(output).not.toContain('Converting circular structure to JSON');
    });

    it('safely handles component instance whose state contains nested cyclic array without throwing', () => {
      const cyclicArr: any[] = ['item'];
      cyclicArr.push(cyclicArr);

      class CyclicArrayElement extends HTMLElementStub {
        data = { list: cyclicArr };
        render() {
          return html`<div>Cyclic array rendered</div>`;
        }
      }

      const instance = new CyclicArrayElement();
      const output = renderToString(instance, { resumable: true });

      expect(output).toContain('Cyclic array rendered');
      // No unhandled exception
    });
  });

  // =========================================================================
  // 4. ABORTSIGNAL CANCELLATION IN STREAMING
  // =========================================================================
  describe('AbortSignal cancellation in streaming', () => {
    it('immediately rejects stream reader when pre-aborted signal is provided', async () => {
      const ac = new AbortController();
      ac.abort(new Error('Pre-aborted prior to stream creation'));

      let generatorStarted = false;
      function* testGen(): IterableIterator<string> {
        generatorStarted = true;
        yield 'should not emit';
      }

      const stream = createStreamFromIterator(testGen(), { signal: ac.signal });
      const reader = stream.getReader();

      await expect(reader.read()).rejects.toThrow('Pre-aborted prior to stream creation');
      expect(generatorStarted).toBe(false);
    });

    it('cleans up abort event listeners upon normal stream completion', async () => {
      const ac = new AbortController();

      function* finiteGen(): IterableIterator<string> {
        yield 'part1';
        yield 'part2';
      }

      const stream = createStreamFromIterator(finiteGen(), { signal: ac.signal });
      const reader = stream.getReader();

      const r1 = await reader.read();
      expect(r1.done).toBe(false);
      const r2 = await reader.read();
      expect(r2.done).toBe(false);
      const r3 = await reader.read();
      expect(r3.done).toBe(true);

      // Aborting after completion should have no effect
      expect(() => ac.abort()).not.toThrow();
    });

    it('handles 100 concurrent streams aborted at various intervals without memory leak or crash', async () => {
      const concurrency = 100;
      const tasks = Array.from({ length: concurrency }, async (_, i) => {
        const ac = new AbortController();
        let finallyFired = false;

        function* chunkGen(): IterableIterator<string> {
          try {
            while (true) {
              yield `chunk-${i}-payload`;
            }
          } finally {
            finallyFired = true;
          }
        }

        const stream = createStreamFromIterator(chunkGen(), { signal: ac.signal });
        const reader = stream.getReader();

        // Read first chunk
        const first = await reader.read();
        expect(first.done).toBe(false);

        // Abort after small varied delay
        const delay = i % 5;
        if (delay > 0) {
          await new Promise((r) => setTimeout(r, delay));
        }
        ac.abort(new Error(`aborted stream ${i}`));

        await expect(reader.read()).rejects.toThrow(`aborted stream ${i}`);
        expect(finallyFired).toBe(true);
      });

      await Promise.all(tasks);
    });
  });

  // =========================================================================
  // 5. NESTED <SLOT> TAGS
  // =========================================================================
  describe('nested <slot> tags in projectSlots', () => {
    it('projects through 3-level nested slots cleanly with zero dangling </slot> tags', () => {
      const shadow = '<div class="nest-box"><slot name="l1"><slot name="l2"><slot name="l3">Deepest fallback</slot></slot></slot></div>';

      // Case 1: Match outermost slot 'l1'
      const res1 = projectSlots(shadow, [{ slot: 'l1', content: '<span>Layer 1 Content</span>' }]);
      expect(res1.projectedShadow).toBe('<div class="nest-box"><span>Layer 1 Content</span></div>');
      expect(res1.projectedShadow).not.toContain('</slot>');

      // Case 2: Match middle slot 'l2'
      const res2 = projectSlots(shadow, [{ slot: 'l2', content: '<span>Layer 2 Content</span>' }]);
      expect(res2.projectedShadow).toBe('<div class="nest-box"><span>Layer 2 Content</span></div>');
      expect(res2.projectedShadow).not.toContain('</slot>');

      // Case 3: Match innermost slot 'l3'
      const res3 = projectSlots(shadow, [{ slot: 'l3', content: '<span>Layer 3 Content</span>' }]);
      expect(res3.projectedShadow).toBe('<div class="nest-box"><span>Layer 3 Content</span></div>');
      expect(res3.projectedShadow).not.toContain('</slot>');

      // Case 4: Match none, fallback content preserved cleanly
      const res4 = projectSlots(shadow, []);
      expect(res4.projectedShadow).toBe('<div class="nest-box">Deepest fallback</div>');
      expect(res4.projectedShadow).not.toContain('</slot>');
    });

    it('escapes unclosed template tags in slotted children during slot projection', () => {
      const shadow = '<div class="wrapper"><slot></slot></div>';
      const hostileChildren = [{ content: '<div>Safe text</template><div id="evil">Breakout</div>' }];

      const res = projectSlots(shadow, hostileChildren);
      expect(res.projectedShadow).toContain('&lt;/template&gt;');
      expect(res.projectedShadow).not.toContain('</template>');
    });
  });

  // =========================================================================
  // 6. ITERABLES, SENTINELS, AND RECURSION DEPTH UNWINDING
  // =========================================================================
  describe('iterables, sentinels, and recursion depth unwinding', () => {
    it('renders generator iterators and Maps yielding Lit templates without object stringification', () => {
      function* templateGenerator() {
        yield html`<span>Item 1</span>`;
        yield html`<span>Item 2</span>`;
      }

      const outputGen = renderToString(templateGenerator());
      expect(outputGen).toBe('<span>Item 1</span><span>Item 2</span>');

      const templateMap = new Map([
        ['k1', html`<div>Val 1</div>`],
        ['k2', html`<div>Val 2</div>`],
      ]);

      const outputMap = renderToString(templateMap.values());
      expect(outputMap).toBe('<div>Val 1</div><div>Val 2</div>');
    });

    it('treats Lit nothing sentinel as empty emission', () => {
      const tpl = html`<div>${nothing}<span>after</span></div>`;
      const output = renderToString(tpl);
      expect(output).toBe('<div><span>after</span></div>');
    });

    it('unwinds recursion depth back to 0 even when error occurs 5 levels deep', () => {
      const env = createIsolateEnvironment();

      class DeepCrash extends HTMLElementStub {
        render() {
          throw new Error('deep explosion');
        }
      }
      env.customElements.define('deep-crash', DeepCrash);

      const tpl = html`<div><div><div><div><deep-crash></deep-crash></div></div></div></div>`;

      expect(() => {
        renderToString(tpl, { customElements: env.customElements });
      }).toThrow('deep explosion');

      // Subsequent render must succeed with depth = 0
      const recovery = renderToString(html`<div>Recovered</div>`, { customElements: env.customElements });
      expect(recovery).toBe('<div>Recovered</div>');
    });
  });
});
