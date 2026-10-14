import { isSerializableValue, serializeStateToJson } from '@lit-core/resumable/server';
import { createIsolateEnvironment, HTMLElementStub, renderToString } from '@lit-core/ssr';
import { html } from 'lit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getTestBrowser } from '../harness.js';

describe('tier 5 challenger 2 empirical stress suite for @lit-core/ssr', () => {
  let browser: any;
  let page: any;
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];

  beforeAll(async () => {
    browser = await getTestBrowser();
    page = await browser.newPage();

    page.on('console', (msg: any) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    page.on('pageerror', (err: any) => {
      pageErrors.push(err.message);
    });
  });

  afterAll(async () => {
    if (page) {
      await page.close();
    }
  });

  // =========================================================================
  // 1. CHROMIUM DSD VISUAL RENDERING WITH MULTI-ATTRIBUTE CUSTOM ELEMENTS
  // =========================================================================
  describe('chromium DSD visual rendering with multi-attribute custom elements', () => {
    it('attaches shadow root and verifies zero console errors for mixed multi-attribute element', async () => {
      consoleErrors.length = 0;
      pageErrors.length = 0;

      const env = createIsolateEnvironment();

      class MixedAttrCard extends HTMLElementStub {
        render() {
          return html`<section class="card-body">
            <h3 id="card-heading">Card Header</h3>
            <div class="card-content"><slot></slot></div>
          </section>`;
        }
      }
      env.customElements.define('mixed-attr-card', MixedAttrCard);

      const id = 'card-empirical-100';
      const cls = 'highlight-panel selected-theme';
      const dis = true;
      const mode = 'dashboard-view';

      const tpl = html`<mixed-attr-card
        id="${id}"
        class="${cls}"
        ?disabled="${dis}"
        data-mode="${mode}"
      >Slotted card text</mixed-attr-card>`;

      const dsdHtml = renderToString(tpl, { customElements: env.customElements });

      // Invariant assertions on server-rendered DSD
      expect(dsdHtml).toContain('<mixed-attr-card');
      expect(dsdHtml).toContain('id="card-empirical-100"');
      expect(dsdHtml).toContain('class="highlight-panel selected-theme"');
      expect(dsdHtml).toContain(' disabled');
      expect(dsdHtml).not.toContain('?disabled=');
      expect(dsdHtml).toContain('data-mode="dashboard-view"');
      expect(dsdHtml).toContain('<template shadowrootmode="open">');
      expect(dsdHtml).not.toContain('<!--lit-part');

      // Inject into headless Chromium
      await page.setContent(`<!DOCTYPE html><html><body><div id="test-mount">${dsdHtml}</div></body></html>`);

      const inspection = await page.evaluate(() => {
        const el = document.getElementById('card-empirical-100');
        if (!el) {
          return { found: false, hasShadow: false, mode: '', isDisabled: false, classList: '', textContent: '' };
        }
        const shadow = el.shadowRoot;
        return {
          found: true,
          hasShadow: Boolean(shadow),
          mode: shadow?.mode || '',
          isDisabled: el.hasAttribute('disabled'),
          classList: el.className,
          dataMode: el.getAttribute('data-mode'),
          textContent: shadow?.querySelector('#card-heading')?.textContent || '',
        };
      });

      expect(inspection.found).toBe(true);
      expect(inspection.hasShadow).toBe(true);
      expect(inspection.mode).toBe('open');
      expect(inspection.isDisabled).toBe(true);
      expect(inspection.classList).toBe('highlight-panel selected-theme');
      expect(inspection.dataMode).toBe('dashboard-view');
      expect(inspection.textContent).toBe('Card Header');

      // Assert strictly zero console errors or uncaught page errors
      expect(consoleErrors).toEqual([]);
      expect(pageErrors).toEqual([]);
    });

    it('attaches shadow root and passes reflected properties without leaking property syntax to DOM', async () => {
      consoleErrors.length = 0;
      pageErrors.length = 0;

      const env = createIsolateEnvironment();

      class UserProfileBadge extends HTMLElementStub {
        userInfo: { name: string; role: string } | null = null;
        counter = 0;
        active = false;

        render() {
          return html`<div class="profile-card">
            <span id="user-display">${this.userInfo?.name} (${this.userInfo?.role})</span>
            <span id="count-display">${this.counter}</span>
            <span id="active-display">${this.active ? 'active' : 'inactive'}</span>
            <slot></slot>
          </div>`;
        }
      }
      env.customElements.define('user-profile-badge', UserProfileBadge);

      const user = { name: 'Elena Rostova', role: 'Staff Engineer' };
      const count = 84;
      const isActive = true;

      const tpl = html`<user-profile-badge
        id="user-badge-1"
        .userInfo="${user}"
        .counter="${count}"
        ?active="${isActive}"
      >Member since 2024</user-profile-badge>`;

      const dsdHtml = renderToString(tpl, { customElements: env.customElements });

      // Property bindings must not leak into attributes
      expect(dsdHtml).not.toContain('.userInfo=');
      expect(dsdHtml).not.toContain('.counter=');
      expect(dsdHtml).toContain(' active');
      expect(dsdHtml).toContain('<template shadowrootmode="open">');
      expect(dsdHtml).toContain('Elena Rostova (Staff Engineer)');
      expect(dsdHtml).toContain('84');
      expect(dsdHtml).toContain('active');

      await page.setContent(`<!DOCTYPE html><html><body><div id="test-mount">${dsdHtml}</div></body></html>`);

      const inspection = await page.evaluate(() => {
        const el = document.getElementById('user-badge-1');
        const shadow = el?.shadowRoot;
        return {
          hasShadow: Boolean(shadow),
          userText: shadow?.querySelector('#user-display')?.textContent || '',
          countText: shadow?.querySelector('#count-display')?.textContent || '',
          activeAttr: el?.hasAttribute('active') || false,
          leakProp1: el?.hasAttribute('.userinfo') || false,
          leakProp2: el?.hasAttribute('.counter') || false,
        };
      });

      expect(inspection.hasShadow).toBe(true);
      expect(inspection.userText).toBe('Elena Rostova (Staff Engineer)');
      expect(inspection.countText).toBe('84');
      expect(inspection.activeAttr).toBe(true);
      expect(inspection.leakProp1).toBe(false);
      expect(inspection.leakProp2).toBe(false);

      expect(consoleErrors).toEqual([]);
      expect(pageErrors).toEqual([]);
    });

    it('attaches shadow roots on sibling custom elements with multi-attributes without crosstalk', async () => {
      consoleErrors.length = 0;
      pageErrors.length = 0;

      const env = createIsolateEnvironment();

      class SiblingBox extends HTMLElementStub {
        boxId = '';
        render() {
          return html`<div class="box-shadow">
            <h4>Box: ${this.boxId}</h4>
            <slot></slot>
          </div>`;
        }
      }
      env.customElements.define('sibling-box', SiblingBox);

      const tpl = html`<div class="container">
        <sibling-box id="sib-1" class="box-first" .boxId="${'alpha'}" ?disabled="${false}">First child</sibling-box>
        <sibling-box id="sib-2" class="box-second" .boxId="${'beta'}" ?disabled="${true}">Second child</sibling-box>
      </div>`;

      const dsdHtml = renderToString(tpl, { customElements: env.customElements });

      await page.setContent(`<!DOCTYPE html><html><body><div id="test-mount">${dsdHtml}</div></body></html>`);

      const inspection = await page.evaluate(() => {
        const b1 = document.getElementById('sib-1');
        const b2 = document.getElementById('sib-2');
        return {
          b1Shadow: Boolean(b1?.shadowRoot),
          b2Shadow: Boolean(b2?.shadowRoot),
          b1Disabled: b1?.hasAttribute('disabled'),
          b2Disabled: b2?.hasAttribute('disabled'),
          b1Header: b1?.shadowRoot?.querySelector('h4')?.textContent || '',
          b2Header: b2?.shadowRoot?.querySelector('h4')?.textContent || '',
        };
      });

      expect(inspection.b1Shadow).toBe(true);
      expect(inspection.b2Shadow).toBe(true);
      expect(inspection.b1Disabled).toBe(false);
      expect(inspection.b2Disabled).toBe(true);
      expect(inspection.b1Header).toBe('Box: alpha');
      expect(inspection.b2Header).toBe('Box: beta');

      expect(consoleErrors).toEqual([]);
      expect(pageErrors).toEqual([]);
    });

    it('attaches shadow roots on nested custom elements both carrying multiple dynamic attributes', async () => {
      consoleErrors.length = 0;
      pageErrors.length = 0;

      const env = createIsolateEnvironment();

      class OuterPanel extends HTMLElementStub {
        panelTitle = '';
        render() {
          return html`<section class="outer-panel">
            <header><h3>${this.panelTitle}</h3></header>
            <main><slot></slot></main>
          </section>`;
        }
      }

      class InnerStatus extends HTMLElementStub {
        level = 'info';
        render() {
          return html`<span class="badge ${this.level}">
            Status: ${this.level} - <slot></slot>
          </span>`;
        }
      }

      env.customElements.define('outer-panel', OuterPanel);
      env.customElements.define('inner-status', InnerStatus);

      const pTitle = 'Security Monitor';
      const sLevel = 'critical';

      const tpl = html`<outer-panel id="panel-root" class="theme-dark" .panelTitle="${pTitle}" ?data-active="${true}">
        <inner-status id="status-leaf" class="badge-pill" .level="${sLevel}" ?data-urgent="${true}">Breach alert</inner-status>
      </outer-panel>`;

      const dsdHtml = renderToString(tpl, { customElements: env.customElements });

      await page.setContent(`<!DOCTYPE html><html><body><div id="test-mount">${dsdHtml}</div></body></html>`);

      const inspection = await page.evaluate(() => {
        const outer = document.getElementById('panel-root');
        const inner = document.getElementById('status-leaf');
        return {
          outerShadow: Boolean(outer?.shadowRoot),
          innerShadow: Boolean(inner?.shadowRoot),
          outerHeader: outer?.shadowRoot?.querySelector('header h3')?.textContent || '',
          innerBadge: inner?.shadowRoot?.querySelector('.badge')?.textContent?.trim() || '',
          outerActive: outer?.hasAttribute('data-active'),
          innerUrgent: inner?.hasAttribute('data-urgent'),
        };
      });

      expect(inspection.outerShadow).toBe(true);
      expect(inspection.innerShadow).toBe(true);
      expect(inspection.outerHeader).toBe('Security Monitor');
      expect(inspection.innerBadge).toContain('Status: critical');
      expect(inspection.outerActive).toBe(true);
      expect(inspection.innerUrgent).toBe(true);

      expect(consoleErrors).toEqual([]);
      expect(pageErrors).toEqual([]);
    });

    it('renders an array of 10 custom elements with multi-attributes and attaches all in Chromium', async () => {
      consoleErrors.length = 0;
      pageErrors.length = 0;

      const env = createIsolateEnvironment();

      class GridRow extends HTMLElementStub {
        rowNumber = -1;
        render() {
          return html`<div class="row-cell">
            <span class="num">${this.rowNumber}</span>
            <slot></slot>
          </div>`;
        }
      }
      env.customElements.define('grid-row', GridRow);

      const items = Array.from({ length: 10 }, (_, i) => ({
        id: `row-${i}`,
        num: i + 1,
        selected: i % 2 === 0,
        label: `Item record ${i + 1}`,
      }));

      const tpl = html`<div class="grid">${items.map(
        (it) => html`<grid-row
          id="${it.id}"
          class="data-row"
          .rowNumber="${it.num}"
          ?data-selected="${it.selected}"
        ><span>${it.label}</span></grid-row>`,
      )}</div>`;

      const dsdHtml = renderToString(tpl, { customElements: env.customElements });

      await page.setContent(`<!DOCTYPE html><html><body><div id="test-mount">${dsdHtml}</div></body></html>`);

      const inspection = await page.evaluate(() => {
        const rows = Array.from(document.querySelectorAll('grid-row'));
        return {
          totalRows: rows.length,
          allHaveShadow: rows.every((r) => r.shadowRoot !== null),
          rowNumbers: rows.map((r) => r.shadowRoot?.querySelector('.num')?.textContent || ''),
          selectedCount: rows.filter((r) => r.hasAttribute('data-selected')).length,
        };
      });

      expect(inspection.totalRows).toBe(10);
      expect(inspection.allHaveShadow).toBe(true);
      expect(inspection.rowNumbers).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10']);
      expect(inspection.selectedCount).toBe(5);

      expect(consoleErrors).toEqual([]);
      expect(pageErrors).toEqual([]);
    });
  });

  // =========================================================================
  // 2. PURE ISOLATE STABILITY AND CIRCULAR GRAPH SERIALIZATION
  // =========================================================================
  describe('pure isolate stability and circular graph serialization', () => {
    it('handles direct and deep indirect circular graphs in state without recursion crash', () => {
      // 1. Direct self reference
      const directCycle: any = { id: 1, name: 'root' };
      directCycle.loop = directCycle;
      expect(isSerializableValue(directCycle)).toBe(false);

      const serializedDirect = serializeStateToJson(directCycle);
      expect(serializedDirect).toContain('"id":1');
      expect(serializedDirect).toContain('"name":"root"');
      expect(JSON.parse(serializedDirect)).toEqual({ id: 1, name: 'root' });

      // 2. Indirect triangular circular graph: A -> B -> C -> A
      const nodeA: any = { name: 'A' };
      const nodeB: any = { name: 'B' };
      const nodeC: any = { name: 'C' };
      nodeA.next = nodeB;
      nodeB.next = nodeC;
      nodeC.next = nodeA;

      expect(isSerializableValue(nodeA)).toBe(false);
      const serializedTriangle = serializeStateToJson(nodeA);
      const parsedTriangle = JSON.parse(serializedTriangle);
      expect(parsedTriangle.name).toBe('A');
      expect(parsedTriangle.next.name).toBe('B');
      expect(parsedTriangle.next.next.name).toBe('C');
      expect(parsedTriangle.next.next.next).toBeUndefined();
    });

    it('serializes cyclic state embedded in custom element and parses cleanly in Chromium', async () => {
      consoleErrors.length = 0;
      pageErrors.length = 0;

      const cyclicState: any = {
        theme: 'nordic',
        version: 3,
        details: { count: 120 },
      };
      cyclicState.self = cyclicState;
      cyclicState.details.parent = cyclicState;

      const dsdOutput = renderToString(
        {
          tagName: 'state-cycle-host',
          shadowHtml: '<div class="shadow-box">State Host</div>',
          attributes: { id: 'cyclic-host' },
          state: cyclicState,
        },
        { resumable: true },
      );

      expect(dsdOutput).toContain('<template shadowrootmode="open">');
      expect(dsdOutput).toContain('<script type="lit/state">');

      await page.setContent(`<!DOCTYPE html><html><body><div id="test-mount">${dsdOutput}</div></body></html>`);

      const browserParsed = await page.evaluate(() => {
        const host = document.getElementById('cyclic-host');
        const script = host?.querySelector('script[type="lit/state"]');
        if (!script) return { found: false, parsed: null };
        try {
          return { found: true, parsed: JSON.parse(script.textContent || '{}') };
        } catch {
          return { found: true, parsed: null };
        }
      });

      expect(browserParsed.found).toBe(true);
      expect(browserParsed.parsed).toEqual({
        theme: 'nordic',
        version: 3,
        details: { count: 120 },
      });

      expect(consoleErrors).toEqual([]);
      expect(pageErrors).toEqual([]);
    });

    it('survives unstringifiable state types: BigInt, Symbol, functions, and throwing getters', () => {
      const hostileState: any = {
        validKey: 'retained-data',
        bigNumber: 9007199254740991000n, // BigInt throws TypeError in JSON.stringify
        func: () => 'malicious',
        symbol: Symbol('token'),
        get throwingProp() {
          throw new Error('Getter evaluation bomb');
        },
      };

      // serializeStateToJson catches the error and safely returns empty dictionary
      const json = serializeStateToJson(hostileState);
      expect(json).toBe('{}');

      // renderToString with unstringifiable state must not throw or abort render
      const output = renderToString(
        {
          tagName: 'unstringifiable-box',
          shadowHtml: '<p>Still rendered</p>',
          state: hostileState,
        },
        { resumable: true },
      );

      expect(output).toContain('<unstringifiable-box>');
      expect(output).toContain('<template shadowrootmode="open">');
      expect(output).toContain('<p>Still rendered</p>');
    });

    it('isolates 25 concurrent environments without registry collision', () => {
      const environments = Array.from({ length: 25 }, () => createIsolateEnvironment());

      environments.forEach((env, idx) => {
        class UniqueComp extends env.HTMLElement {
          idx = idx;
        }
        env.customElements.define('collision-test-tag', UniqueComp);

        const retrieved = env.customElements.get('collision-test-tag');
        expect(retrieved).toBe(UniqueComp);
        const inst = new retrieved();
        expect(inst.idx).toBe(idx);
      });

      // Assert distinct environments retain their own constructors without cross-talk
      for (let i = 0; i < 25; i++) {
        const Ctor = environments[i].customElements.get('collision-test-tag');
        expect(Ctor).toBeDefined();
        const instance = new (Ctor as any)();
        expect(instance.idx).toBe(i);
      }
    });
  });
});
