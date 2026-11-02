import { describe, expect, it } from 'vitest';
import { splitServerElement } from '../src/index.js';

describe('server-split aot compiler', () => {
  it('returns uncompiled result for regular non-server classes', () => {
    const code = `
      export class SimpleButton {
        onClick() {
          console.log('clicked');
        }
      }
    `;

    const res = splitServerElement(code);
    expect(res.isServerElement).toBe(false);
    expect(res.clientCode).toBe(code);
    expect(res.workerCode).toBe(code);
    expect(res.actions).toHaveLength(0);
    expect(res.loaders).toHaveLength(0);
  });

  it('splits server element into worker and zero-lit client artifacts', () => {
    const code = `
      import { LitElement, html } from 'lit';
      import { customElement } from 'lit/decorators.js';
      import { loader, action } from '@lit-core/server-elements';

      @customElement('user-card')
      export class UserCard extends LitElement {
        static properties = {
          userId: { type: String },
          name: { type: String },
        };

        @loader()
        async fetchUserData(id: string) {
          this.name = 'Bob';
        }

        @action()
        async updateName(newName: string) {
          this.name = newName;
        }

        render() {
          return html\`<div>\${this.name}</div>\`;
        }
      }
    `;

    const res = splitServerElement(code);
    expect(res.isServerElement).toBe(true);
    expect(res.hasErrors).toBe(false);
    expect(res.tagName).toBe('user-card');
    expect(res.className).toBe('UserCard');

    // Worker artifact assertions
    expect(res.workerCode).toContain('class UserCard extends LitElement');
    expect(res.workerCode).toContain('async fetchUserData(id: string)');
    expect(res.workerCode).toContain('async updateName(newName: string)');
    expect(res.workerCode).toContain('UserCard.__lit_actions =');
    expect(res.workerCode).toContain('UserCard.__lit_loaders =');
    expect(res.workerCode).toContain('__lit_validate_updateName');
    expect(res.workerCode).not.toContain('@loader()');
    expect(res.workerCode).not.toContain('@action()');

    // Client artifact assertions (zero-Lit HTMLElement)
    expect(res.clientCode).toContain('import { __litActionRpc } from "@lit-core/server-elements/client";');
    expect(res.clientCode).toContain('class UserCard extends HTMLElement');
    expect(res.clientCode).toContain('constructor()');
    expect(res.clientCode).toContain('super();');
    expect(res.clientCode).toContain('async updateName(newName: string)');
    expect(res.clientCode).toContain('return __litActionRpc(this,');
    expect(res.clientCode).not.toContain('fetchUserData');
    expect(res.clientCode).not.toContain('render()');
    expect(res.clientCode).not.toContain('from "lit"');

    // Metadata assertions
    expect(res.actions).toHaveLength(1);
    expect(res.actions[0].name).toBe('updateName');
    expect(res.actions[0].hash).toMatch(/^[0-9a-f]{16}$/);
    expect(res.actions[0].writtenProperties).toEqual(['name']);

    expect(res.loaders).toHaveLength(1);
    expect(res.loaders[0].name).toBe('fetchUserData');
    expect(res.loaders[0].writtenProperties).toEqual(['name']);
  });

  it('preserves LitElement inheritance when component has client lifecycle methods', () => {
    const code = `
      import { LitElement, html } from 'lit';
      import { action } from '@lit-core/server-elements';

      export class StatefulElement extends LitElement {
        static properties = {
          count: { type: Number },
        };

        firstUpdated() {
          console.log('Mounted on client');
        }

        @action()
        async add(val: number) {
          this.count += val;
        }
      }
    `;

    const res = splitServerElement(code);
    expect(res.isServerElement).toBe(true);
    // Since it contains firstUpdated(), it cannot be lowered to zero-Lit pure HTMLElement
    expect(res.clientCode).toContain('class StatefulElement extends LitElement');
    expect(res.clientCode).toContain('firstUpdated()');
  });

  it('does not lower component to zero-Lit when decorated property (@property/@state) is present', () => {
    const code = `
      import { LitElement, html } from 'lit';
      import { property } from 'lit/decorators.js';
      import { action } from '@lit-core/server-elements';

      export class DecoratedComp extends LitElement {
        @property({ type: Number })
        count = 0;

        @action()
        async inc() {
          this.count++;
        }

        render() {
          return html\`<div>\${this.count}</div>\`;
        }
      }
    `;

    const res = splitServerElement(code);
    expect(res.isServerElement).toBe(true);
    // Must remain LitElement because decorated property requires Lit reactive decorator runtime
    expect(res.clientCode).toContain('class DecoratedComp extends LitElement');
  });

  it('emits customElements.define in zero-Lit client artifact when @customElement was stripped', () => {
    const code = `
      import { LitElement, html } from 'lit';
      import { customElement } from 'lit/decorators.js';
      import { action } from '@lit-core/server-elements';

      @customElement('simple-counter')
      export class SimpleCounter extends LitElement {
        static properties = { count: { type: Number } };

        @action()
        async inc() {
          this.count++;
        }

        render() {
          return html\`<div>\${this.count}</div>\`;
        }
      }
    `;

    const res = splitServerElement(code);
    expect(res.isServerElement).toBe(true);
    expect(res.clientCode).toContain('class SimpleCounter extends HTMLElement');
    expect(res.clientCode).not.toContain('@customElement');
    expect(res.clientCode).toContain('customElements.define("simple-counter", SimpleCounter);');
  });

  it('produces identical action hash across parameter renaming, whitespace, and formatting changes', () => {
    const codeA = `
      import { LitElement, html } from 'lit';
      import { action } from '@lit-core/server-elements';

      export class CartItem extends LitElement {
        static properties = { qty: { type: Number } };

        @action()
        async updateQuantity(newQuantity: number) {
          // Update the quantity
          this.qty = newQuantity;
        }
      }
    `;

    const codeB = `
      import { LitElement } from 'lit';
      import { action } from '@lit-core/server-elements';

      export class CartItem extends LitElement {
        static properties = { qty: { type: Number } };

        @action()
        async updateQuantity(q: number) {
          this.qty = q;
        }
      }
    `;

    const resA = splitServerElement(codeA);
    const resB = splitServerElement(codeB);

    expect(resA.actions[0].hash).toBeDefined();
    expect(resB.actions[0].hash).toBeDefined();
    expect(resA.actions[0].hash).toBe(resB.actions[0].hash);
  });
});
