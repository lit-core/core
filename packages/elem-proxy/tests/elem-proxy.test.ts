import './setup.js';
import { LitElement } from 'lit';
import { describe, expect, it } from 'vitest';
import { transformElemProxy } from '../src/index.js';

describe('elem-proxy core transform', () => {
  it('transforms @customElement decorated Lit component into proxy stub and implementation closure', () => {
    const input = `
import { LitElement, html } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

@customElement('my-button')
export class MyButton extends LitElement {
  @property({ type: String, attribute: 'custom-label' })
  label = 'default';

  @property({ type: Boolean })
  disabled = false;

  @state()
  active = false;

  render() {
    return html\`<button ?disabled=\${this.disabled}>\${this.label}</button>\`;
  }
}
`;

    const res = transformElemProxy(input);
    expect(res.proxiedElementsCount).toBe(1);
    expect(res.elements[0].tagName).toBe('my-button');
    expect(res.elements[0].className).toBe('MyButton');
    expect(res.elements[0].properties).toContain('label');
    expect(res.elements[0].properties).toContain('disabled');
    expect(res.elements[0].properties).toContain('active');
    expect(res.elements[0].observedAttributes).toContain('custom-label');
    expect(res.elements[0].observedAttributes).toContain('disabled');
    expect(res.elements[0].observedAttributes).not.toContain('active');

    // Code structure assertions
    expect(res.code).toContain('__getImpl_MyButton');
    expect(res.code).toMatch(/customElements\.define\(['"]my-button['"],\s*MyButtonProxy\)/);
    expect(res.code).toMatch(/export\s*\{\s*MyButtonProxy\s+as\s+MyButton\s*\}/);
  });

  it('transforms customElements.define registration into proxy stub', () => {
    const input = `
import { LitElement } from 'lit';

export class FancyCard extends LitElement {
  static properties = {
    title: { type: String, attribute: 'card-title' },
    elevation: { type: Number },
    internalState: { state: true },
  };
}

customElements.define('fancy-card', FancyCard);
`;

    const res = transformElemProxy(input);
    expect(res.proxiedElementsCount).toBe(1);
    expect(res.elements[0].tagName).toBe('fancy-card');
    expect(res.elements[0].className).toBe('FancyCard');
    expect(res.elements[0].properties).toContain('title');
    expect(res.elements[0].properties).toContain('elevation');
    expect(res.elements[0].properties).toContain('internalState');
    expect(res.elements[0].observedAttributes).toContain('card-title');
    expect(res.elements[0].observedAttributes).toContain('elevation');
    expect(res.elements[0].observedAttributes).not.toContain('internalState');

    expect(res.code).toContain('__getImpl_FancyCard');
    expect(res.code).toMatch(/customElements\.define\(['"]fancy-card['"],\s*FancyCardProxy\)/);
  });

  it('transforms external customElements.define registration without local class declaration', () => {
    const input = `
import { ExternalButton } from './button.js';

customElements.define('ext-button', ExternalButton);
`;
    const res = transformElemProxy(input);
    expect(res.proxiedElementsCount).toBe(1);
    expect(res.elements[0].tagName).toBe('ext-button');
    expect(res.elements[0].className).toBe('ExternalButton');
    expect(res.code).toContain('class ExternalButtonProxy extends HTMLElement');
    expect(res.code).toMatch(/customElements\.define\(['"]ext-button['"],\s*ExternalButtonProxy\)/);
  });

  it('preserves non-custom-element code without modifications', () => {
    const input = `
export const add = (a: number, b: number) => a + b;
export class Helper {
  sayHello() { return 'hello'; }
}
`;
    const res = transformElemProxy(input);
    expect(res.proxiedElementsCount).toBe(0);
    expect(res.code).toBe(input);
  });
});

describe('elem-proxy runtime behavior', () => {
  it('defers class evaluation until mount or property access', () => {
    let heavyEvaluated = false;

    // Simulate emitted code
    let __impl_TestDefer: any = null;
    function __getImpl_TestDefer() {
      if (!__impl_TestDefer) {
        heavyEvaluated = true;
        class TestDefer extends LitElement {
          static properties = { count: { type: Number } };
          count = 0;
        }
        __impl_TestDefer = TestDefer;
      }
      return __impl_TestDefer;
    }

    class TestDeferProxy extends HTMLElement {
      static get observedAttributes() {
        return ['count'];
      }
      static [Symbol.hasInstance](instance: any) {
        const Impl = __getImpl_TestDefer();
        return (Impl && instance instanceof Impl) || super[Symbol.hasInstance](instance);
      }
      __upgraded = false;
      __attrBuffer: any = null;
      connectedCallback() {
        this.__upgrade();
      }
      __upgrade() {
        if (this.__upgraded) return this;
        this.__upgraded = true;
        const RealClass = __getImpl_TestDefer();
        if (typeof RealClass.finalize === 'function') RealClass.finalize();
        Object.setPrototypeOf(this, RealClass.prototype);
        (this as any).isUpdatePending = false;
        (this as any).hasUpdated = false;
        (this as any)._$changedProperties ??= new Map();
        (this as any)._$AL ??= new Map();
        if (!(this as any).renderOptions) (this as any).renderOptions = { host: this };
        if (typeof (this as any)._$initialize === 'function') (this as any)._$initialize();
        if (typeof (this as any)._$Ev === 'function') (this as any)._$Ev();
        return this;
      }
    }

    Object.defineProperty(TestDeferProxy.prototype, 'count', {
      get() {
        this.__upgrade();
        return (this as any).count;
      },
      set(v) {
        this.__upgrade();
        (this as any).count = v;
      },
      configurable: true,
      enumerable: true,
    });

    expect(heavyEvaluated).toBe(false);

    const el = new (TestDeferProxy as any)();
    expect(heavyEvaluated).toBe(false);

    // Property access triggers upgrade
    el.count = 50;
    expect(heavyEvaluated).toBe(true);
    expect(el.count).toBe(50);
  });

  it('preserves prototype and resolves instanceof correctly', () => {
    class RealComp extends LitElement {
      static properties = { val: { type: String } };
    }

    let _impl: any = null;
    function getImpl() {
      if (!_impl) _impl = RealComp;
      return _impl;
    }

    class CompProxy extends HTMLElement {
      static get observedAttributes() {
        return ['val'];
      }
      static [Symbol.hasInstance](instance: any) {
        const Impl = getImpl();
        return (Impl && instance instanceof Impl) || super[Symbol.hasInstance](instance);
      }
      __upgraded = false;
      __upgrade() {
        if (this.__upgraded) return this;
        this.__upgraded = true;
        const RealClass = getImpl();
        RealClass.finalize();
        Object.setPrototypeOf(this, RealClass.prototype);
        return this;
      }
    }

    const inst = new (CompProxy as any)();
    // Before upgrade:
    expect(inst instanceof (CompProxy as any)).toBe(true);

    // Upgrade
    inst.__upgrade();

    // After upgrade:
    expect(inst instanceof RealComp).toBe(true);
    expect(inst instanceof (CompProxy as any)).toBe(true);
  });

  it('reflects attributes set before connection upon upgrade', () => {
    class AttrComp extends LitElement {
      static properties = {
        title: { type: String, attribute: 'comp-title' },
        count: { type: Number },
      };
      title = '';
      count = 0;
    }

    let _impl: any = null;
    function getImpl() {
      if (!_impl) _impl = AttrComp;
      return _impl;
    }

    class AttrCompProxy extends HTMLElement {
      static get observedAttributes() {
        return ['comp-title', 'count'];
      }
      __upgraded = false;
      __attrBuffer: Map<string, string> | null = null;
      attributeChangedCallback(name: string, oldValue: string, newValue: string) {
        if (this.__upgraded) {
          // @ts-expect-error
          if (typeof super.attributeChangedCallback === 'function') {
            // @ts-expect-error
            super.attributeChangedCallback(name, oldValue, newValue);
          }
        } else {
          if (!this.__attrBuffer) this.__attrBuffer = new Map();
          this.__attrBuffer.set(name, newValue);
        }
      }
      connectedCallback() {
        this.__upgrade();
      }
      __upgrade() {
        if (this.__upgraded) return this;
        this.__upgraded = true;
        const RealClass = getImpl();
        RealClass.finalize();
        Object.setPrototypeOf(this, RealClass.prototype);
        (this as any).isUpdatePending = false;
        (this as any).hasUpdated = false;
        (this as any)._$changedProperties ??= new Map();
        (this as any)._$AL ??= new Map();
        if (!(this as any).renderOptions) (this as any).renderOptions = { host: this };
        if (typeof (this as any)._$initialize === 'function') (this as any)._$initialize();
        if (typeof (this as any)._$Ev === 'function') (this as any)._$Ev();

        if (this.__attrBuffer) {
          for (const [k, v] of this.__attrBuffer) {
            if (typeof (this as any).attributeChangedCallback === 'function') {
              (this as any).attributeChangedCallback(k, null, v);
            }
          }
          this.__attrBuffer = null;
        }
        return this;
      }
    }

    const el = new (AttrCompProxy as any)();
    // Simulate HTML parser attribute setting
    el.attributeChangedCallback('comp-title', null, 'Hello World');
    el.attributeChangedCallback('count', null, '123');

    expect(_impl).toBeNull();

    // Connect and upgrade
    el.connectedCallback();
    expect(_impl).not.toBeNull();
    expect(el.title).toBe('Hello World');
    expect(el.count).toBe(123);
  });
});
