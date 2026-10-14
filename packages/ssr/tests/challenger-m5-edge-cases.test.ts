import { html } from 'lit';
import { describe, expect, it } from 'vitest';
import { createIsolateEnvironment, HTMLElementStub, renderToString } from '../src/index.js';

describe('milestone 5 iteration 3 empirical challenge edge cases for @lit-core/ssr', () => {
  // =========================================================================
  // 1. ELEMENTS WITH 4+ MIXED DYNAMIC ATTRIBUTES
  // =========================================================================
  describe('elements with 4+ mixed dynamic attributes', () => {
    it('correctly handles 4+ mixed dynamic attributes with quotes', () => {
      const env = createIsolateEnvironment();

      let instanceProps: Record<string, unknown> = {};

      class MultiMixedElem extends HTMLElementStub {
        id?: string;
        disabled?: boolean;
        count?: number;
        customHandler?: (...args: unknown[]) => unknown;

        render() {
          instanceProps = {
            id: this.id,
            disabled: this.disabled,
            count: this.count,
            hasAttributeDisabled: this.hasAttribute?.('disabled'),
          };
          return html`<div class="inner">Count: ${this.count}</div>`;
        }
      }
      env.customElements.define('multi-mixed-elem', MultiMixedElem);

      const id = 'card-dyn-99';
      const dis = true;
      const c = 42;
      const fn = () => 'clicked';

      // Exact requirement: id="${id}" class="static" ?disabled="${dis}" .count="${c}" @click="${fn}"
      const tpl = html`<multi-mixed-elem id="${id}" class="static" ?disabled="${dis}" .count="${c}" @click="${fn}">Child Slot Content</multi-mixed-elem>`;
      const output = renderToString(tpl, { customElements: env.customElements, resumable: true });

      // Verification of emitted HTML:
      // 1. Tag starts correctly
      expect(output).toContain('<multi-mixed-elem');
      // 2. id attribute rendered
      expect(output).toContain('id="card-dyn-99"');
      // 3. static class rendered
      expect(output).toContain('class="static"');
      // 4. boolean disabled rendered as boolean attribute
      expect(output).toContain(' disabled');
      expect(output).not.toContain('?disabled=');
      // 5. property binding .count must NOT leak into HTML attributes
      expect(output).not.toContain('.count=');
      expect(output).not.toContain('count="42"');
      // 6. event handler @click must NOT leak as @click in HTML attributes
      expect(output).not.toContain('@click=');
      // In resumable mode, resumes-on-click is rendered
      expect(output).toContain('resumes-on-click');
      // 7. Declarative Shadow DOM rendered
      expect(output).toContain('<template shadowrootmode="open">');
      expect(output).toContain('<div class="inner">Count: 42</div>');
      expect(output).toContain('Child Slot Content');
      expect(output).toContain('</multi-mixed-elem>');

      // Verification of component instance properties:
      expect(instanceProps.disabled).toBe(true);
      expect(instanceProps.count).toBe(42);
    });

    it('handles 4+ mixed dynamic attributes without quotes around holes', () => {
      const env = createIsolateEnvironment();

      let capturedCount: number | undefined;
      let capturedFlag: boolean | undefined;

      class UnquotedMixedElem extends HTMLElementStub {
        count?: number;
        flag?: boolean;
        render() {
          capturedCount = this.count;
          capturedFlag = this.flag;
          return html`<span>Count is ${this.count}</span>`;
        }
      }
      env.customElements.define('unquoted-mixed-elem', UnquotedMixedElem);

      const id = 'unquoted-1';
      const c = 100;
      const flag = true;
      const fn = () => {};

      const tpl = html`<unquoted-mixed-elem id=${id} class="static-mid" ?flag=${flag} .count=${c} @keydown=${fn}>Inner</unquoted-mixed-elem>`;
      const output = renderToString(tpl, { customElements: env.customElements });

      expect(output).toContain('id="unquoted-1"');
      expect(output).toContain('class="static-mid"');
      expect(output).toContain(' flag');
      expect(output).not.toContain('?flag=');
      expect(output).not.toContain('.count=');
      expect(output).not.toContain('@keydown=');
      expect(output).toContain('<span>Count is 100</span>');

      expect(capturedCount).toBe(100);
      expect(capturedFlag).toBe(true);
    });

    it('handles 5+ mixed attributes including kebab-case properties and multiple boolean flags', () => {
      const env = createIsolateEnvironment();

      class DeepMixedElem extends HTMLElementStub {
        userProfile?: { name: string };
        accountStatus?: string;
        isActive?: boolean;
        isSuperuser?: boolean;

        render() {
          return html`<div>User: ${this.userProfile?.name}, Status: ${this.accountStatus}, Active: ${this.isActive}, Super: ${this.isSuperuser}</div>`;
        }
      }
      env.customElements.define('deep-mixed-elem', DeepMixedElem);

      const profile = { name: 'Empirical Challenger' };
      const status = 'verified';
      const active = true;
      const superuser = false;
      const testId = 'deep-1';

      const tpl = html`<deep-mixed-elem
        data-testid="${testId}"
        class="deep-class"
        .userProfile="${profile}"
        .accountStatus="${status}"
        ?isActive="${active}"
        ?isSuperuser="${superuser}"
        @change="${() => {}}"
      >
        <span>Slotted content</span>
      </deep-mixed-elem>`;

      const output = renderToString(tpl, { customElements: env.customElements });

      const openTag = output.slice(0, output.indexOf('>'));
      expect(openTag).toContain('data-testid="deep-1"');
      expect(openTag).toContain('class="deep-class"');
      expect(openTag).toContain('isActive');
      // Falsy boolean flag must NOT appear in opening tag
      expect(openTag).not.toContain('isSuperuser');
      // Property bindings must NOT appear in opening tag
      expect(openTag).not.toContain('userProfile');
      expect(openTag).not.toContain('accountStatus');
      // Event bindings must NOT appear as @change in opening tag
      expect(openTag).not.toContain('@change');

      expect(output).toContain('User: Empirical Challenger, Status: verified, Active: true, Super: false');
      expect(output).toContain('<span>Slotted content</span>');
    });
  });

  // =========================================================================
  // 2. TRUTHY AND FALSY BOOLEAN ATTRIBUTE TOGGLING
  // =========================================================================
  describe('truthy and falsy boolean attribute toggling', () => {
    it('toggles boolean attributes on custom element instances and HTML output', () => {
      const env = createIsolateEnvironment();

      class ToggleElem extends HTMLElementStub {
        disabled?: boolean;
        active?: boolean;
        loading?: boolean;

        render() {
          return html`<p>disabled=${String(this.disabled)}, active=${String(this.active)}, loading=${String(this.loading)}</p>`;
        }
      }
      env.customElements.define('toggle-elem', ToggleElem);

      // Case A: disabled=true, active=false, loading=null
      const tplA = html`<toggle-elem ?disabled="${true}" ?active="${false}" ?loading="${null}"></toggle-elem>`;
      const outA = renderToString(tplA, { customElements: env.customElements });

      const openTagA = outA.slice(0, outA.indexOf('>'));
      expect(openTagA).toContain(' disabled');
      expect(openTagA).not.toContain('active');
      expect(openTagA).not.toContain('loading');
      expect(outA).toContain('disabled=true, active=false, loading=false');

      // Case B: disabled=false, active=true, loading=undefined
      const tplB = html`<toggle-elem ?disabled="${false}" ?active="${true}" ?loading="${undefined}"></toggle-elem>`;
      const outB = renderToString(tplB, { customElements: env.customElements });

      const openTagB = outB.slice(0, outB.indexOf('>'));
      expect(openTagB).not.toContain('disabled');
      expect(openTagB).toContain(' active');
      expect(openTagB).not.toContain('loading');
      expect(outB).toContain('disabled=false, active=true, loading=false');
    });

    it('evaluates JS truthy/falsy values for boolean attributes according to standard semantics', () => {
      const env = createIsolateEnvironment();

      class FalsyCheckElem extends HTMLElementStub {
        flagZero?: boolean;
        flagEmptyStr?: boolean;
        flagNull?: boolean;
        flagUndefined?: boolean;
        flagNum?: boolean;
        flagStr?: boolean;

        render() {
          return html`<div>
            zero=${String(this.flagZero)},
            empty=${String(this.flagEmptyStr)},
            null=${String(this.flagNull)},
            undef=${String(this.flagUndefined)},
            num=${String(this.flagNum)},
            str=${String(this.flagStr)}
          </div>`;
        }
      }
      env.customElements.define('falsy-check-elem', FalsyCheckElem);

      const tpl = html`<falsy-check-elem
        ?flagZero="${0}"
        ?flagEmptyStr="${''}"
        ?flagNull="${null}"
        ?flagUndefined="${undefined}"
        ?flagNum="${1}"
        ?flagStr="${'active'}"
      ></falsy-check-elem>`;

      const out = renderToString(tpl, { customElements: env.customElements });
      const openTag = out.slice(0, out.indexOf('>'));

      // 0, '', null, undefined are falsy in boolean attributes:
      expect(openTag).not.toContain('flagZero');
      expect(openTag).not.toContain('flagEmptyStr');
      expect(openTag).not.toContain('flagNull');
      expect(openTag).not.toContain('flagUndefined');

      // 1 and 'active' are truthy:
      expect(openTag).toContain(' flagNum');
      expect(openTag).toContain(' flagStr');

      // Instance reflects boolean converted values:
      expect(out).toContain('zero=false');
      expect(out).toContain('empty=false');
      expect(out).toContain('null=false');
      expect(out).toContain('undef=false');
      expect(out).toContain('num=true');
      expect(out).toContain('str=true');
    });

    it('correctly toggles boolean attributes on standard HTML elements', () => {
      const tpl = html`<div>
        <button id="btn-enabled" ?disabled="${false}">Click me</button>
        <button id="btn-disabled" ?disabled="${true}">Disabled</button>
        <input id="chk-checked" type="checkbox" ?checked="${true}" ?readonly="${false}" />
        <input id="chk-unchecked" type="checkbox" ?checked="${false}" ?readonly="${true}" />
      </div>`;

      const out = renderToString(tpl);

      expect(out).toContain('<button id="btn-enabled">Click me</button>');
      expect(out).toContain('<button id="btn-disabled" disabled>Disabled</button>');
      expect(out).toContain('<input id="chk-checked" type="checkbox" checked />');
      expect(out).toContain('<input id="chk-unchecked" type="checkbox" readonly />');
    });
  });

  // =========================================================================
  // 3. MAPPED ARRAYS OF CUSTOM ELEMENTS WITH MULTIPLE DYNAMIC PROPERTIES
  // =========================================================================
  describe('mapped arrays of custom elements with multiple dynamic properties', () => {
    it('correctly maps array of 10 custom elements with alternating boolean flags and multiple properties', () => {
      const env = createIsolateEnvironment();

      interface ItemData {
        id: string;
        title: string;
        rank: number;
        featured: boolean;
      }

      const receivedElements: Array<{ id: string; rank: number; featured: boolean; title: string }> = [];

      class CardRow extends HTMLElementStub {
        cardId = '';
        cardRank = -1;
        isFeatured = false;
        meta?: { title: string };

        render() {
          receivedElements.push({
            id: this.cardId,
            rank: this.cardRank,
            featured: this.isFeatured,
            title: this.meta?.title ?? '',
          });
          return html`<div class="card-inner">
            <span class="rank">${this.cardRank}</span>
            <span class="title">${this.meta?.title}</span>
            <slot></slot>
          </div>`;
        }
      }
      env.customElements.define('card-row', CardRow);

      const items: ItemData[] = Array.from({ length: 10 }, (_, i) => ({
        id: `card-${i}`,
        title: `Item Title ${i}`,
        rank: i * 10,
        featured: i % 2 === 0,
      }));

      const tpl = html`<section class="catalog">
        ${items.map(
          (item) => html`<card-row
            id="${item.id}"
            class="card-item"
            .cardId="${item.id}"
            .cardRank="${item.rank}"
            ?isFeatured="${item.featured}"
            .meta="${{ title: item.title }}"
            @select="${() => {}}"
          >
            <p>Description for ${item.id}</p>
          </card-row>`,
        )}
      </section>`;

      const output = renderToString(tpl, { customElements: env.customElements });

      // Verify all 10 custom elements rendered with DSD
      const dsdMatches = output.match(/<template shadowrootmode="open">/g);
      expect(dsdMatches?.length).toBe(10);

      // Verify each received element got its own independent properties
      expect(receivedElements.length).toBe(10);
      for (let i = 0; i < 10; i++) {
        expect(receivedElements[i]).toEqual({
          id: `card-${i}`,
          rank: i * 10,
          featured: i % 2 === 0,
          title: `Item Title ${i}`,
        });

        expect(output).toContain(`id="card-${i}"`);
        expect(output).toContain(`Description for card-${i}`);
        expect(output).toContain(`<span class="rank">${i * 10}</span>`);
        expect(output).toContain(`<span class="title">Item Title ${i}</span>`);

        const openTagRegex = new RegExp(`<card-row[^>]*id="card-${i}"[^>]*>`);
        const match = output.match(openTagRegex);
        expect(match).not.toBeNull();
        const openTag = match?.[0] ?? '';

        if (i % 2 === 0) {
          expect(openTag).toContain('isFeatured');
        } else {
          expect(openTag).not.toContain('isFeatured');
        }
      }

      // Ensure no property bindings leaked
      expect(output).not.toContain('.cardRank=');
      expect(output).not.toContain('.cardId=');
      expect(output).not.toContain('.meta=');
      expect(output).not.toContain('@select=');
    });

    it('handles nested mapped arrays of custom elements with multiple dynamic properties', () => {
      const env = createIsolateEnvironment();

      class ParentGroup extends HTMLElementStub {
        groupId = '';
        render() {
          return html`<fieldset class="group-box"><legend>${this.groupId}</legend><slot></slot></fieldset>`;
        }
      }

      class ChildItem extends HTMLElementStub {
        itemId = '';
        active = false;
        value = -1;
        render() {
          return html`<span class="badge ${this.active ? 'active' : 'inactive'}">Val: ${this.value}</span>`;
        }
      }

      env.customElements.define('parent-group', ParentGroup);
      env.customElements.define('child-item', ChildItem);

      const groups = [
        {
          id: 'group-A',
          children: [
            { id: 'a1', val: 10, act: true },
            { id: 'a2', val: 20, act: false },
          ],
        },
        {
          id: 'group-B',
          children: [
            { id: 'b1', val: 30, act: false },
            { id: 'b2', val: 40, act: true },
          ],
        },
      ];

      const tpl = html`<div class="container">
        ${groups.map(
          (grp) => html`<parent-group id="${grp.id}" .groupId="${grp.id}">
            ${grp.children.map((child) => html`<child-item id="${child.id}" .itemId="${child.id}" ?active="${child.act}" .value="${child.val}"></child-item>`)}
          </parent-group>`,
        )}
      </div>`;

      const output = renderToString(tpl, { customElements: env.customElements });

      expect(output).toContain('<parent-group id="group-A"');
      expect(output).toContain('<parent-group id="group-B"');
      expect(output).toContain('<legend>group-A</legend>');
      expect(output).toContain('<legend>group-B</legend>');

      expect(output).toContain('<child-item id="a1" active');
      expect(output).toContain('<span class="badge active">Val: 10</span>');

      expect(output).toContain('<child-item id="a2"');
      expect(output).not.toMatch(/<child-item id="a2"[^>]*active/);
      expect(output).toContain('<span class="badge inactive">Val: 20</span>');

      expect(output).toContain('<child-item id="b1"');
      expect(output).not.toMatch(/<child-item id="b1"[^>]*active/);
      expect(output).toContain('<span class="badge inactive">Val: 30</span>');

      expect(output).toContain('<child-item id="b2" active');
      expect(output).toContain('<span class="badge active">Val: 40</span>');

      // Total 2 parent + 4 child = 6 custom elements with DSD
      const dsdMatches = output.match(/<template shadowrootmode="open">/g);
      expect(dsdMatches?.length).toBe(6);
    });
  });
});
