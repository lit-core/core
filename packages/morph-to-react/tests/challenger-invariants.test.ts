import { describe, expect, it } from 'vitest';
import { analyzeLitModule } from '../src/index.js';

describe('milestone 1 challenger invariants: n-api bridge verification', () => {
  it('empirically verifies static formAssociated = !0 triggers Tier 2 facade classification', () => {
    const code = `
      import { LitElement, html } from 'lit';

      export class MinifiedCheckbox extends LitElement {
        static formAssociated = !0;

        render() {
          return html\`<input type="checkbox" />\`;
        }
      }
    `;

    const result = analyzeLitModule(code, { filename: 'checkbox.ts' });
    expect(result.components).toHaveLength(1);
    expect(result.components[0].tier).toBe('Tier2HostedWithFacade');
  });

  it('empirically verifies static formAssociated = !1 does NOT trigger Tier 2', () => {
    const code = `
      import { LitElement, html } from 'lit';

      export class NonFormElement extends LitElement {
        static formAssociated = !1;

        render() {
          return html\`<span>Static</span>\`;
        }
      }
    `;

    const result = analyzeLitModule(code, { filename: 'non-form.ts' });
    expect(result.components).toHaveLength(1);
    expect(result.components[0].tier).toBe('Tier0Pure');
  });

  it('empirically verifies static shadowRootOptions with delegatesFocus = !0 triggers Tier 2', () => {
    const code = `
      import { LitElement, html } from 'lit';

      export class DelegatedButton extends LitElement {
        static shadowRootOptions = { delegatesFocus: !0, mode: 'open' };

        render() {
          return html\`<button>Focus</button>\`;
        }
      }
    `;

    const result = analyzeLitModule(code, { filename: 'delegated.ts' });
    expect(result.components).toHaveLength(1);
    expect(result.components[0].tier).toBe('Tier2HostedWithFacade');
  });

  it('empirically verifies aliased directive imports trigger bailout (LIT101) with @lit/task hint', () => {
    const code = `
      import { LitElement, html } from 'lit';
      import { until as u } from 'lit/directives/until.js';

      export class AsyncCard extends LitElement {
        render() {
          return html\`<div>\${u(Promise.resolve('ready'), html\`<span>wait</span>\`)}</div>\`;
        }
      }
    `;

    const result = analyzeLitModule(code, { filename: 'async-card.ts' });
    expect(result.components).toHaveLength(1);
    expect(result.components[0].tier).toBe('Bailout');

    const diag = result.diagnostics.find((d) => d.code === 'LIT101');
    expect(diag).toBeDefined();
    expect(diag?.universalLitHint).toContain('@lit/task');
  });

  it('empirically verifies non-Lit classes extending imported base classes without Lit markers are ignored', () => {
    const code = `
      import { DataStore } from './store.js';
      import { Controller } from '@mvc/core';

      export class UserStore extends DataStore {
        loadUser() { return { name: 'Bob' }; }
      }

      export class AppController extends Controller {
        init() {}
      }
    `;

    const result = analyzeLitModule(code, { filename: 'services.ts' });
    expect(result.components).toHaveLength(0);
    expect(result.diagnostics).toHaveLength(0);
  });

  it('empirically verifies cross-module Lit subclass with Lit markers captures superClass and emits LIT108', () => {
    const code = `
      import { html } from 'lit';
      import { BaseCard } from './base-card.js';

      export class SpecialCard extends BaseCard {
        render() {
          return html\`<div class="card">Special</div>\`;
        }
      }
    `;

    const result = analyzeLitModule(code, { filename: 'special-card.ts' });
    expect(result.components).toHaveLength(1);
    expect(result.components[0].className).toBe('SpecialCard');
    expect(result.components[0].superClass).toBe('BaseCard');

    const diag = result.diagnostics.find((d) => d.code === 'LIT108');
    expect(diag).toBeDefined();
  });

  it('empirically verifies hasChanged callbacks are extracted in PropertyDto', () => {
    const code = `
      import { LitElement, property, state } from 'lit';

      export class FilteredTable extends LitElement {
        @property({
          type: String,
          hasChanged: (newVal, oldVal) => newVal !== oldVal
        })
        query = '';

        @state({
          hasChanged: (n, o) => n > o
        })
        cursor = 0;

        static properties = {
          items: {
            type: Array,
            hasChanged(newItems, oldItems) {
              return newItems.length !== oldItems.length;
            }
          }
        };
      }
    `;

    const result = analyzeLitModule(code, { filename: 'filtered-table.ts' });
    expect(result.components).toHaveLength(1);

    const comp = result.components[0];
    const queryProp = comp.properties.find((p) => p.name === 'query');
    expect(queryProp).toBeDefined();
    expect(queryProp?.hasChanged).toContain('newVal !== oldVal');

    const cursorPos = comp.properties.find((p) => p.name === 'cursor');
    expect(cursorPos).toBeDefined();
    expect(cursorPos?.hasChanged).toContain('n > o');

    const itemsProp = comp.properties.find((p) => p.name === 'items');
    expect(itemsProp).toBeDefined();
    expect(itemsProp?.hasChanged).toContain('hasChanged(newItems, oldItems)');
  });
});
