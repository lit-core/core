import { html, nothing } from 'lit';
import { describe, expect, it } from 'vitest';
import { createIsolateEnvironment, createStreamFromIterator, HTMLElementStub, renderToStream, renderToString } from '../src/index.js';

describe('milestone 5 empirical challenger stress test suite for @lit-core/ssr', () => {
  // =========================================================================
  // 1. SINGLE DYNAMIC ATTRIBUTE BASELINE AND EDGE CASES (PASSING ROBUSTLY)
  // =========================================================================
  describe('single dynamic attribute baseline and position handling', () => {
    it('handles single dynamic attribute at different positions: beginning, middle, and end of tag', () => {
      const env = createIsolateEnvironment();

      class PosElem extends HTMLElementStub {
        render() {
          return html`<section class="pos-shadow"><slot></slot></section>`;
        }
      }
      env.customElements.define('pos-elem', PosElem);

      // 1. Dynamic at the beginning
      const out1 = renderToString(html`<pos-elem id="${'first-dyn'}" class="static-middle" data-end="static-end">content1</pos-elem>`, { customElements: env.customElements });
      expect(out1).toContain('<pos-elem id="first-dyn" class="static-middle" data-end="static-end">');
      expect(out1).toContain('<template shadowrootmode="open">');

      // 2. Dynamic in the middle
      const out2 = renderToString(html`<pos-elem class="static-first" id="${'mid-dyn'}" data-end="static-end">content2</pos-elem>`, { customElements: env.customElements });
      expect(out2).toContain('<pos-elem class="static-first" id="mid-dyn" data-end="static-end">');
      expect(out2).toContain('<template shadowrootmode="open">');

      // 3. Dynamic at the end
      const out3 = renderToString(html`<pos-elem class="static-first" data-mid="static-mid" id="${'last-dyn'}">content3</pos-elem>`, { customElements: env.customElements });
      expect(out3).toContain('<pos-elem class="static-first" data-mid="static-mid" id="last-dyn">');
      expect(out3).toContain('<template shadowrootmode="open">');
    });

    it('safely escapes special characters and quotes in dynamic attribute values', () => {
      const env = createIsolateEnvironment();

      class SafeElem extends HTMLElementStub {
        render() {
          return html`<div><slot></slot></div>`;
        }
      }
      env.customElements.define('safe-elem', SafeElem);

      const hostileId = 'test<>&"\'/val';
      const tpl = html`<safe-elem id="${hostileId}">safe text</safe-elem>`;
      const output = renderToString(tpl, { customElements: env.customElements });

      // Verifies attributes are escaped preventing attribute breakout
      expect(output).toContain('id="test&lt;&gt;&amp;&quot;\'/val"');
      expect(output).toContain('<template shadowrootmode="open">');
    });

    it('handles multiline attributes with irregular spacing and newlines', () => {
      const env = createIsolateEnvironment();

      class SpacingElem extends HTMLElementStub {
        render() {
          return html`<div class="space-view"><slot></slot></div>`;
        }
      }
      env.customElements.define('spacing-elem', SpacingElem);

      const idVal = 'spacing-123';
      const tpl = html`<spacing-elem
        id="${idVal}"
        class="first-class
               second-class"
      >
        <span>Child text</span>
      </spacing-elem>`;

      const output = renderToString(tpl, { customElements: env.customElements });
      expect(output).toContain('id="spacing-123"');
      expect(output).toContain('<template shadowrootmode="open">');
      expect(output).toContain('<span>Child text</span>');
    });
  });

  // =========================================================================
  // 2. PROPERTY REFLECTION ON SINGLE ATTRIBUTES (PASSING ROBUSTLY)
  // =========================================================================
  describe('property reflection on single dynamic bindings', () => {
    it('invokes prototype setter when property binding is applied', () => {
      const env = createIsolateEnvironment();

      let setterCalledWith: unknown = null;

      class SetterElem extends HTMLElementStub {
        private _dataPayload: any = null;

        get dataPayload() {
          return this._dataPayload;
        }

        set dataPayload(val: any) {
          this._dataPayload = val;
          setterCalledWith = val;
        }

        render() {
          return html`<div>Payload received: ${this._dataPayload?.key}</div>`;
        }
      }
      env.customElements.define('setter-elem', SetterElem);

      const complexObj = { key: 'secret-token-777', timestamp: 123456789 };
      const tpl = html`<setter-elem .dataPayload="${complexObj}"></setter-elem>`;

      const output = renderToString(tpl, { customElements: env.customElements });

      expect(setterCalledWith).toBe(complexObj);
      expect(output).toContain('Payload received: secret-token-777');
    });

    it('reflects kebab-case property bindings to camelCase properties on component instance', () => {
      const env = createIsolateEnvironment();

      class KebabElem extends HTMLElementStub {
        mySpecialValue?: string;
        render() {
          return html`<span>Special: ${this.mySpecialValue}</span>`;
        }
      }
      env.customElements.define('kebab-elem', KebabElem);

      const tpl = html`<kebab-elem .my-special-value="${'kebab-success'}"></kebab-elem>`;
      const output = renderToString(tpl, { customElements: env.customElements });

      expect(output).toContain('<span>Special: kebab-success</span>');
    });

    it('preserves exact object references across deep property values without cloning', () => {
      const env = createIsolateEnvironment();

      let receivedReference: any = null;

      class ReferenceCheckElem extends HTMLElementStub {
        refObj: any;
        render() {
          receivedReference = this.refObj;
          return html`<div>Reference checked</div>`;
        }
      }
      env.customElements.define('reference-check-elem', ReferenceCheckElem);

      const origin = { nested: { map: new Map([['a', 1]]) }, func: () => 'original' };
      const tpl = html`<reference-check-elem .refObj="${origin}"></reference-check-elem>`;

      renderToString(tpl, { customElements: env.customElements });

      expect(receivedReference).toBe(origin);
      expect(receivedReference.nested.map.get('a')).toBe(1);
      expect(receivedReference.func()).toBe('original');
    });
  });

  // =========================================================================
  // 3. STREAMING AND ABORT HANDLING (PASSING ROBUSTLY)
  // =========================================================================
  describe('streaming iterables and abort signal handling', () => {
    it('aborts active streaming of custom elements cleanly when AbortSignal fires mid-stream', async () => {
      const env = createIsolateEnvironment();

      class AbortChunkElem extends HTMLElementStub {
        render() {
          return html`<div class="chunk">Rendered</div>`;
        }
      }
      env.customElements.define('abort-chunk-elem', AbortChunkElem);

      const ac = new AbortController();

      function* largeElementGenerator(): IterableIterator<any> {
        for (let i = 0; i < 50; i++) {
          yield html`<abort-chunk-elem id="chunk-${i}">Text ${i}</abort-chunk-elem>`;
        }
      }

      const stream = createStreamFromIterator(largeElementGenerator(), { signal: ac.signal });
      const reader = stream.getReader();

      const first = await reader.read();
      expect(first.done).toBe(false);

      ac.abort(new Error('Challenger intentional abort'));

      await expect(reader.read()).rejects.toThrow('Challenger intentional abort');
    });

    it('streams custom elements with single dynamic attribute chunk-by-chunk', async () => {
      const env = createIsolateEnvironment();

      class SingleStreamItem extends HTMLElementStub {
        itemNo: number = 0;
        render() {
          return html`<div class="item-shadow">Item #${this.itemNo}</div>`;
        }
      }
      env.customElements.define('single-stream-item', SingleStreamItem);

      const totalItems = 15;
      const items = Array.from({ length: totalItems }, (_, i) => ({ id: `stream-${i}`, no: i }));

      const tpl = html`<main>${items.map((it) => html`<single-stream-item id="${it.id}"><span>Content ${it.no}</span></single-stream-item>`)}</main>`;

      const stream = renderToStream(tpl, { customElements: env.customElements });
      const reader = stream.getReader();
      const chunks: string[] = [];
      const decoder = new TextDecoder();

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value) {
          chunks.push(decoder.decode(value, { stream: true }));
        }
      }

      const fullHtml = chunks.join('');
      expect(chunks.length).toBeGreaterThan(1);
      expect(fullHtml).toContain('<main>');
      expect(fullHtml).toContain('</main>');

      for (let i = 0; i < totalItems; i++) {
        expect(fullHtml).toContain(`id="stream-${i}"`);
        expect(fullHtml).toContain(`<span>Content ${i}</span>`);
      }
    });
  });

  // =========================================================================
  // 4. NESTED AND ARRAY CUSTOM ELEMENTS WITH SINGLE DYNAMIC BINDING (PASSING)
  // =========================================================================
  describe('nested and array custom elements with single dynamic binding', () => {
    it('handles arrays mixing custom elements, conditional nothing, and standard HTML elements', () => {
      const env = createIsolateEnvironment();

      class ListItem extends HTMLElementStub {
        render() {
          return html`<li class="list-shadow"><slot></slot></li>`;
        }
      }
      env.customElements.define('list-item', ListItem);

      const entries = [
        { id: 'e1', show: true, isCustom: true, label: 'Custom 1' },
        { id: 'e2', show: false, isCustom: true, label: 'Custom 2 (Hidden)' },
        { id: 'e3', show: true, isCustom: false, label: 'Standard HTML 3' },
        { id: 'e4', show: true, isCustom: true, label: 'Custom 4' },
      ];

      const tpl = html`<ul>${entries.map((e) => {
        if (!e.show) return nothing;
        if (e.isCustom) {
          return html`<list-item id="${e.id}">${e.label}</list-item>`;
        }
        return html`<li id="${e.id}" class="standard">${e.label}</li>`;
      })}</ul>`;

      const output = renderToString(tpl, { customElements: env.customElements });

      expect(output).toContain('<list-item id="e1"><template shadowrootmode="open"><li class="list-shadow"><slot></slot></li></template>Custom 1</list-item>');
      expect(output).not.toContain('e2');
      expect(output).not.toContain('Custom 2');
      expect(output).toContain('<li id="e3" class="standard">Standard HTML 3</li>');
      expect(output).toContain('<list-item id="e4"><template shadowrootmode="open"><li class="list-shadow"><slot></slot></li></template>Custom 4</list-item>');
    });

    it('structures nested custom elements and reflects property on both levels', () => {
      const env = createIsolateEnvironment();

      class OuterContainer extends HTMLElementStub {
        outerTitle: string = '';
        render() {
          return html`<div class="outer-wrap">
            <h2>${this.outerTitle}</h2>
            <div class="inner-slot"><slot></slot></div>
          </div>`;
        }
      }

      class InnerPill extends HTMLElementStub {
        innerBadge: string = '';
        render() {
          return html`<span class="pill-badge">[${this.innerBadge}] <slot></slot></span>`;
        }
      }

      env.customElements.define('outer-container', OuterContainer);
      env.customElements.define('inner-pill', InnerPill);

      const outerTitle = 'Executive Dashboard';
      const innerBadge = 'VIP';
      const slotText = 'User Details';

      const tpl = html`<outer-container id="outer-1" class="outer-cls" .outerTitle="${outerTitle}">
        <inner-pill id="inner-1" class="inner-cls" .innerBadge="${innerBadge}">
          <b>${slotText}</b>
        </inner-pill>
      </outer-container>`;

      const output = renderToString(tpl, { customElements: env.customElements });

      expect(output).toContain('<outer-container id="outer-1" class="outer-cls">');
      expect(output).toContain('<h2>Executive Dashboard</h2>');
      expect(output).toContain('<inner-pill id="inner-1" class="inner-cls">');
      expect(output).toContain('<span class="pill-badge">[VIP] <slot></slot></span>');
      expect(output).toContain('<b>User Details</b>');

      const dsdMatches = output.match(/<template shadowrootmode="open">/g);
      expect(dsdMatches?.length).toBe(2);
    });
  });

  // =========================================================================
  // 5. EMPIRICALLY CONFIRMED DEFECTS: MULTIPLE DYNAMIC ATTRIBUTES PER TAG
  // =========================================================================
  describe('adversarial challenges: multiple dynamic attributes on custom elements', () => {
    it('demonstrates defect: <my-card id="${id}" class="static" ?disabled="${dis}"> emits ?disabled="true" instead of boolean attr and drops instance property', () => {
      const env = createIsolateEnvironment();
      let instanceDisabledVal: boolean | undefined;

      class MyCard extends HTMLElementStub {
        disabled?: boolean;
        render() {
          instanceDisabledVal = this.disabled;
          return html`<div class="card-inner">Card Content</div>`;
        }
      }
      env.customElements.define('my-card', MyCard);

      const id = 'card-100';
      const dis = true;

      // Exact pattern assigned in DISPATCH.md:
      // <my-card id="${id}" class="static" ?disabled="${dis}">
      const tpl = html`<my-card id="${id}" class="static" ?disabled="${dis}">Hello</my-card>`;
      const output = renderToString(tpl, { customElements: env.customElements });

      // EXPECTED SPECIFICATION REQUIREMENTS:
      // 1. Boolean attribute ?disabled="${true}" should emit " disabled", NOT literal '?disabled="true"'
      expect(output).toContain(' disabled');
      expect(output).not.toContain('?disabled="true"');

      // 2. Component instance must have received this.disabled === true prior to render()
      expect(instanceDisabledVal).toBe(true);
    });

    it('demonstrates defect: multiple property bindings .userInfo="${user}" .counter="${count}" drops all bindings after the first', () => {
      const env = createIsolateEnvironment();

      let receivedUser: any = null;
      let receivedCounter: any = null;

      class MultiPropElem extends HTMLElementStub {
        userInfo: any = null;
        counter: number = -1;

        render() {
          receivedUser = this.userInfo;
          receivedCounter = this.counter;
          return html`<div>Multi prop body</div>`;
        }
      }
      env.customElements.define('multi-prop-elem', MultiPropElem);

      const user = { name: 'Alice', role: 'Staff' };
      const count = 42;

      const tpl = html`<multi-prop-elem .userInfo="${user}" .counter="${count}"></multi-prop-elem>`;
      const output = renderToString(tpl, { customElements: env.customElements });

      // First property binding succeeds
      expect(receivedUser).toEqual({ name: 'Alice', role: 'Staff' });

      // EXPECTED SPECIFICATION REQUIREMENT:
      // Second property binding (.counter) must be reflected onto instance, NOT dropped to default -1
      expect(receivedCounter).toBe(42);

      // Property binding syntax must never leak into DOM attributes
      expect(output).not.toContain('.counter="42"');
    });

    it('demonstrates defect: array of custom elements with multiple dynamic attributes drops secondary bindings', () => {
      const env = createIsolateEnvironment();

      const receivedIndices: number[] = [];

      class RowItemMulti extends HTMLElementStub {
        itemIdx: number = -1;
        render() {
          receivedIndices.push(this.itemIdx);
          return html`<li>Row: ${this.itemIdx}</li>`;
        }
      }
      env.customElements.define('row-item-multi', RowItemMulti);

      const items = [0, 1, 2, 3, 4];
      const tpl = html`<ul>${items.map((idx) => html`<row-item-multi id="row-${idx}" .itemIdx="${idx}"></row-item-multi>`)}</ul>`;

      const output = renderToString(tpl, { customElements: env.customElements });

      // EXPECTED SPECIFICATION REQUIREMENT:
      // In <row-item-multi id="row-${idx}" .itemIdx="${idx}">,
      // .itemIdx is the second dynamic binding and must be passed to each instance
      expect(receivedIndices).toEqual([0, 1, 2, 3, 4]);
      expect(output).not.toContain('.itemIdx=');
    });
  });
});
