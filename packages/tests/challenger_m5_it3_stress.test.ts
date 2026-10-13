import { describe, expect, it } from 'vitest';
import { transformElemProxy } from '../elem-proxy/src/index.js';
import { classify, transformNative } from '../native/src/index.js';
import { CARBON_COMPONENTS, MATERIAL_COMPONENTS, MOMENTUM_COMPONENTS, SPECTRUM_COMPONENTS, WEBAWESOME_COMPONENTS } from './src/components.js';
import { readComponentSource } from './src/fixtures.js';

function prepareRunnableCode(code: string): string {
  return code
    .replace(/import [^;]+;/g, '')
    .replace(/export\s+default\s+/g, '')
    .replace(/export\s+class\s+/g, 'class ')
    .replace(/export\s+\{[^}]+\};?/g, '');
}

describe('empirical challenger m5 iteration 3 stress battery', () => {
  // =========================================================================
  // FOCUS AREA 1: ELEM-PROXY PROPERTY READS AND WRITES ON INSTANTIATED ELEMENTS
  // =========================================================================
  describe('focus area 1: elem-proxy property reads and writes on instantiated elements', () => {
    it('verifies zero RangeError on property writes before connection across diverse types', () => {
      const input = `
import { LitElement } from 'lit';

export class MultiPropEl extends LitElement {
  static properties = {
    strProp: { type: String },
    numProp: { type: Number },
    boolProp: { type: Boolean },
    arrProp: { type: Array },
    objProp: { type: Object },
    funcProp: { type: Function },
  };
}
customElements.define('multi-prop-el', MultiPropEl);
`;
      const res = transformElemProxy(input);
      expect(res.proxiedElementsCount).toBe(1);

      class MockHTMLElement {
        isConnected = false;
      }
      class MockLitElement extends MockHTMLElement {
        static finalize() {}
      }

      let RegisteredClass: any = null;
      const codeToRun = prepareRunnableCode(res.code);
      const fn = new Function('HTMLElement', 'LitElement', 'customElements', codeToRun);
      fn(MockHTMLElement, MockLitElement, {
        define: (_tag: string, cls: any) => {
          RegisteredClass = cls;
        },
      });

      expect(RegisteredClass).not.toBeNull();
      const el = new RegisteredClass();

      // Write string
      expect(() => {
        el.strProp = 'valid string';
      }).not.toThrow();
      expect(el.strProp).toBe('valid string');

      // Write number
      expect(() => {
        el.numProp = 42;
      }).not.toThrow();
      expect(el.numProp).toBe(42);

      // Write boolean
      expect(() => {
        el.boolProp = true;
      }).not.toThrow();
      expect(el.boolProp).toBe(true);

      // Write array
      const arr = [1, 2, 3];
      expect(() => {
        el.arrProp = arr;
      }).not.toThrow();
      expect(el.arrProp).toBe(arr);

      // Write object
      const obj = { nested: 'data' };
      expect(() => {
        el.objProp = obj;
      }).not.toThrow();
      expect(el.objProp).toBe(obj);

      // Write function
      const f = () => 'fn-res';
      expect(() => {
        el.funcProp = f;
      }).not.toThrow();
      expect(el.funcProp).toBe(f);
      expect(el.funcProp()).toBe('fn-res');
    });

    it('verifies repeated writes to the same property update cleanly without recursion across 1000 iterations', () => {
      const input = `
import { LitElement } from 'lit';

export class RepeatedWriteEl extends LitElement {
  static properties = {
    count: { type: Number },
  };
}
customElements.define('repeated-write-el', RepeatedWriteEl);
`;
      const res = transformElemProxy(input);
      const codeToRun = prepareRunnableCode(res.code);

      class MockHTMLElement {
        isConnected = false;
      }
      class MockLitElement extends MockHTMLElement {
        static finalize() {}
      }

      let RegisteredClass: any = null;
      const fn = new Function('HTMLElement', 'LitElement', 'customElements', codeToRun);
      fn(MockHTMLElement, MockLitElement, {
        define: (_tag: string, cls: any) => {
          RegisteredClass = cls;
        },
      });

      const el = new RegisteredClass();
      for (let i = 0; i < 1000; i++) {
        el.count = i;
        expect(el.count).toBe(i);
      }
    });

    it('verifies reading declared properties before write or connection returns safely with zero RangeError', () => {
      const input = `
import { LitElement } from 'lit';

export class UnsetReadEl extends LitElement {
  static properties = {
    unsetValue: { type: String },
  };
}
customElements.define('unset-read-el', UnsetReadEl);
`;
      const res = transformElemProxy(input);
      const codeToRun = prepareRunnableCode(res.code);

      class MockHTMLElement {
        isConnected = false;
      }
      class MockLitElement extends MockHTMLElement {
        static finalize() {}
      }

      let RegisteredClass: any = null;
      const fn = new Function('HTMLElement', 'LitElement', 'customElements', codeToRun);
      fn(MockHTMLElement, MockLitElement, {
        define: (_tag: string, cls: any) => {
          RegisteredClass = cls;
        },
      });

      const el = new RegisteredClass();
      let readVal: any;
      expect(() => {
        readVal = el.unsetValue;
      }).not.toThrow();
      expect(readVal).toBeUndefined();
    });

    it('traverses deep prototype chains and preserves inherited methods and getters/setters', () => {
      const input = `
import { LitElement } from 'lit';

export class BaseParentEl extends LitElement {
  static properties = {
    parentProp: { type: String },
  };
  baseHelper() { return 'from-base'; }
}

export class ChildSubEl extends BaseParentEl {
  static properties = {
    childProp: { type: Number },
  };
  childHelper() { return 'from-child'; }
}
customElements.define('child-sub-el', ChildSubEl);
`;
      const res = transformElemProxy(input);
      expect(res.proxiedElementsCount).toBe(1);

      class MockHTMLElement {
        isConnected = false;
      }
      class MockLitElement extends MockHTMLElement {
        static finalize() {}
        createRenderRoot() {
          return this;
        }
        requestUpdate() {
          return true;
        }
      }

      let RegisteredClass: any = null;
      const codeToRun = prepareRunnableCode(res.code);
      const fn = new Function('HTMLElement', 'LitElement', 'customElements', codeToRun);
      fn(MockHTMLElement, MockLitElement, {
        define: (_tag: string, cls: any) => {
          RegisteredClass = cls;
        },
      });

      const el = new RegisteredClass();
      el.childProp = 99;
      expect(el.childProp).toBe(99);

      // Verify methods copied across the prototype chain
      expect(typeof el.childHelper).toBe('function');
      expect(el.childHelper()).toBe('from-child');

      expect(typeof el.baseHelper).toBe('function');
      expect(el.baseHelper()).toBe('from-base');

      expect(typeof el.createRenderRoot).toBe('function');
      expect(el.createRenderRoot()).toBe(el);

      expect(typeof el.requestUpdate).toBe('function');
      expect(el.requestUpdate()).toBe(true);
    });

    it('delegates to custom getters and setters defined on the underlying implementation class', () => {
      const input = `
import { LitElement } from 'lit';

export class CustomAccessorEl extends LitElement {
  static properties = {
    title: { type: String },
  };
  get title() {
    return 'FORMATTED:' + (this._title || 'empty');
  }
  set title(val) {
    this._title = String(val).toUpperCase();
  }
}
customElements.define('custom-accessor-el', CustomAccessorEl);
`;
      const res = transformElemProxy(input);
      const codeToRun = prepareRunnableCode(res.code);

      class MockHTMLElement {
        isConnected = false;
      }
      class MockLitElement extends MockHTMLElement {
        static finalize() {}
      }

      let RegisteredClass: any = null;
      const fn = new Function('HTMLElement', 'LitElement', 'customElements', codeToRun);
      fn(MockHTMLElement, MockLitElement, {
        define: (_tag: string, cls: any) => {
          RegisteredClass = cls;
        },
      });

      const el = new RegisteredClass();
      expect(el.title).toBe('FORMATTED:empty');

      el.title = 'hello world';
      expect(el.title).toBe('FORMATTED:HELLO WORLD');
    });

    it('ensures independent instances maintain isolated property values without state leakage', () => {
      const input = `
import { LitElement } from 'lit';

export class IsolatedEl extends LitElement {
  static properties = {
    value: { type: String },
  };
}
customElements.define('isolated-el', IsolatedEl);
`;
      const res = transformElemProxy(input);
      const codeToRun = prepareRunnableCode(res.code);

      class MockHTMLElement {
        isConnected = false;
      }
      class MockLitElement extends MockHTMLElement {
        static finalize() {}
      }

      let RegisteredClass: any = null;
      const fn = new Function('HTMLElement', 'LitElement', 'customElements', codeToRun);
      fn(MockHTMLElement, MockLitElement, {
        define: (_tag: string, cls: any) => {
          RegisteredClass = cls;
        },
      });

      const el1 = new RegisteredClass();
      const el2 = new RegisteredClass();

      el1.value = 'instance-one';
      expect(el1.value).toBe('instance-one');
      expect(el2.value).toBeUndefined();

      el2.value = 'instance-two';
      expect(el1.value).toBe('instance-one');
      expect(el2.value).toBe('instance-two');
    });

    it('verifies undeclared property read and write behaves normally without interference', () => {
      const input = `
import { LitElement } from 'lit';

export class ExtraPropEl extends LitElement {
  static properties = {
    declared: { type: String },
  };
}
customElements.define('extra-prop-el', ExtraPropEl);
`;
      const res = transformElemProxy(input);
      const codeToRun = prepareRunnableCode(res.code);

      class MockHTMLElement {
        isConnected = false;
      }
      class MockLitElement extends MockHTMLElement {
        static finalize() {}
      }

      let RegisteredClass: any = null;
      const fn = new Function('HTMLElement', 'LitElement', 'customElements', codeToRun);
      fn(MockHTMLElement, MockLitElement, {
        define: (_tag: string, cls: any) => {
          RegisteredClass = cls;
        },
      });

      const el = new RegisteredClass();
      el.declared = 'yes';
      el.extraNonDeclared = 'also-works';

      expect(el.declared).toBe('yes');
      expect(el.extraNonDeclared).toBe('also-works');
    });
  });

  // =========================================================================
  // FOCUS AREA 2: ELEM-PROXY LIFECYCLE AND CONNECTEDCALLBACK GUARD
  // =========================================================================
  describe('focus area 2: elem-proxy lifecycle and connectedCallback guard', () => {
    it('verifies connectedCallback is not prematurely invoked on unconnected elements', () => {
      const input = `
import { LitElement } from 'lit';

export class LifecycleCheckEl extends LitElement {
  static properties = {
    status: { type: String },
  };
  connectedCallback() {
    this._connectedInvoked = true;
  }
}
customElements.define('lifecycle-check-el', LifecycleCheckEl);
`;
      const res = transformElemProxy(input);
      const codeToRun = prepareRunnableCode(res.code);

      class MockHTMLElement {
        isConnected = false;
      }
      class MockLitElement extends MockHTMLElement {
        static finalize() {}
      }

      let RegisteredClass: any = null;
      const fn = new Function('HTMLElement', 'LitElement', 'customElements', codeToRun);
      fn(MockHTMLElement, MockLitElement, {
        define: (_tag: string, cls: any) => {
          RegisteredClass = cls;
        },
      });

      const el = new RegisteredClass();
      expect(el.isConnected).toBe(false);

      // Accessing a property triggers __upgrade()
      el.status = 'active';
      expect(el.status).toBe('active');

      // Crucial verification: connectedCallback MUST NOT have run while unconnected
      expect(el._connectedInvoked).toBeUndefined();

      // Now simulate connection to document DOM
      el.isConnected = true;
      el.connectedCallback();
      expect(el._connectedInvoked).toBe(true);
    });

    it('verifies connectedCallback executes immediately when upgraded on an already-connected element', () => {
      const input = `
import { LitElement } from 'lit';

export class AlreadyConnectedEl extends LitElement {
  static properties = {
    name: { type: String },
  };
  connectedCallback() {
    this._hookCalled = true;
  }
}
customElements.define('already-connected-el', AlreadyConnectedEl);
`;
      const res = transformElemProxy(input);
      const codeToRun = prepareRunnableCode(res.code);

      class MockHTMLElement {
        isConnected = true; // Connected directly
      }
      class MockLitElement extends MockHTMLElement {
        static finalize() {}
      }

      let RegisteredClass: any = null;
      const fn = new Function('HTMLElement', 'LitElement', 'customElements', codeToRun);
      fn(MockHTMLElement, MockLitElement, {
        define: (_tag: string, cls: any) => {
          RegisteredClass = cls;
        },
      });

      const el = new RegisteredClass();
      expect(el.isConnected).toBe(true);

      // Upgrade via property set
      el.name = 'connected-test';
      expect(el._hookCalled).toBe(true);
    });

    it('verifies multiple connectedCallback invocations on reconnect behave idempotently', () => {
      const input = `
import { LitElement } from 'lit';

export class ReconnectEl extends LitElement {
  static properties = {
    flag: { type: Boolean },
  };
  connectedCallback() {
    this.connectCount = (this.connectCount || 0) + 1;
  }
}
customElements.define('reconnect-el', ReconnectEl);
`;
      const res = transformElemProxy(input);
      const codeToRun = prepareRunnableCode(res.code);

      class MockHTMLElement {
        isConnected = false;
      }
      class MockLitElement extends MockHTMLElement {
        static finalize() {}
      }

      let RegisteredClass: any = null;
      const fn = new Function('HTMLElement', 'LitElement', 'customElements', codeToRun);
      fn(MockHTMLElement, MockLitElement, {
        define: (_tag: string, cls: any) => {
          RegisteredClass = cls;
        },
      });

      const el = new RegisteredClass();
      el.flag = true;
      expect(el.connectCount).toBeUndefined();

      // First connection
      el.isConnected = true;
      el.connectedCallback();
      expect(el.connectCount).toBe(1);

      // Disconnect and reconnect
      el.isConnected = false;
      el.isConnected = true;
      el.connectedCallback();
      expect(el.connectCount).toBe(2);
    });

    it('verifies seamless property interaction after connection without regression', () => {
      const input = `
import { LitElement } from 'lit';

export class PostConnectPropEl extends LitElement {
  static properties = {
    theme: { type: String },
  };
  connectedCallback() {
    this._connected = true;
  }
}
customElements.define('post-connect-prop-el', PostConnectPropEl);
`;
      const res = transformElemProxy(input);
      const codeToRun = prepareRunnableCode(res.code);

      class MockHTMLElement {
        isConnected = false;
      }
      class MockLitElement extends MockHTMLElement {
        static finalize() {}
      }

      let RegisteredClass: any = null;
      const fn = new Function('HTMLElement', 'LitElement', 'customElements', codeToRun);
      fn(MockHTMLElement, MockLitElement, {
        define: (_tag: string, cls: any) => {
          RegisteredClass = cls;
        },
      });

      const el = new RegisteredClass();
      el.isConnected = true;
      el.connectedCallback();
      expect(el._connected).toBe(true);

      // Read and write properties after connection
      el.theme = 'solarized-dark';
      expect(el.theme).toBe('solarized-dark');
      el.theme = 'solarized-light';
      expect(el.theme).toBe('solarized-light');
    });
  });

  // =========================================================================
  // FOCUS AREA 3: NATIVE REGISTRATION ZERO DUPLICATE CUSTOMELEMENTS.DEFINE
  // =========================================================================
  describe('focus area 3: native registration zero duplicate customElements.define', () => {
    it('emits exactly one customElements.define when input source code already contains define call', () => {
      const input = `
import { LitElement, html } from 'lit';

export class PreDefinedEl extends LitElement {
  render() {
    return html\`<span>plain</span>\`;
  }
}
customElements.define('pre-defined-el', PreDefinedEl);
`;
      const res = transformNative(input);
      expect(res.vanillaCount).toBe(1);

      const matches = res.code.match(/customElements\.define\(['"]pre-defined-el['"],\s*PreDefinedEl\)/g);
      expect(matches).not.toBeNull();
      expect(matches).toHaveLength(1);
    });

    it('emits exactly one customElements.define when input uses @customElement decorator', () => {
      const input = `
import { LitElement, html } from 'lit';
import { customElement } from 'lit/decorators.js';

@customElement('decorator-el')
export class DecoratorEl extends LitElement {
  render() {
    return html\`<div>decorated</div>\`;
  }
}
`;
      const res = transformNative(input);
      expect(res.vanillaCount).toBe(1);

      const matches = res.code.match(/customElements\.define\(['"]decorator-el['"],\s*DecoratorEl\)/g);
      expect(matches).not.toBeNull();
      expect(matches).toHaveLength(1);
    });

    it('handles aliased decorator import and emits exactly one customElements.define', () => {
      const input = `
import { LitElement, html } from 'lit';
import { customElement as ce } from 'lit/decorators.js';

@ce('aliased-ce-el')
export class AliasedCeEl extends LitElement {
  render() {
    return html\`<p>aliased</p>\`;
  }
}
`;
      const res = transformNative(input);
      expect(res.vanillaCount).toBe(1);

      const matches = res.code.match(/customElements\.define\(['"]aliased-ce-el['"],\s*AliasedCeEl\)/g);
      expect(matches).not.toBeNull();
      expect(matches).toHaveLength(1);
    });

    it('handles namespace decorator import and emits exactly one customElements.define', () => {
      const input = `
import { LitElement, html } from 'lit';
import * as decs from 'lit/decorators.js';

@decs.customElement('ns-ce-el')
export class NsCeEl extends LitElement {
  render() {
    return html\`<p>namespace</p>\`;
  }
}
`;
      const res = transformNative(input);
      expect(res.vanillaCount).toBe(1);

      const matches = res.code.match(/customElements\.define\(['"]ns-ce-el['"],\s*NsCeEl\)/g);
      expect(matches).not.toBeNull();
      expect(matches).toHaveLength(1);
    });

    it('correctly registers multiple classes in a single file without duplicates', () => {
      const input = `
import { LitElement, html } from 'lit';
import { customElement } from 'lit/decorators.js';

@customElement('multi-comp-a')
export class MultiCompA extends LitElement {
  render() { return html\`<a>A</a>\`; }
}

export class MultiCompB extends LitElement {
  render() { return html\`<b>B</b>\`; }
}
customElements.define('multi-comp-b', MultiCompB);
`;
      const res = transformNative(input);
      expect(res.vanillaCount).toBe(2);

      const matchesA = res.code.match(/customElements\.define\(['"]multi-comp-a['"],\s*MultiCompA\)/g);
      const matchesB = res.code.match(/customElements\.define\(['"]multi-comp-b['"],\s*MultiCompB\)/g);

      expect(matchesA).toHaveLength(1);
      expect(matchesB).toHaveLength(1);
    });

    it('bails out cleanly on unsupported dynamic tag template without altering customElements.define', () => {
      const input = `
import { LitElement, html } from 'lit';

export class DynamicTagComp extends LitElement {
  render() {
    return html\`<\${this.tag}>dynamic</\${this.tag}>\`;
  }
}
customElements.define('dynamic-tag-comp', DynamicTagComp);
`;
      const res = transformNative(input);
      expect(res.vanillaCount).toBe(0); // Bailed out safely
      expect(res.code).toContain('class DynamicTagComp extends LitElement');

      const matches = res.code.match(/customElements\.define\(['"]dynamic-tag-comp['"],\s*DynamicTagComp\)/g);
      expect(matches).toHaveLength(1);
    });

    it('bails out cleanly on non-Lit custom elements with zero modification or duplicate define', () => {
      const input = `
export class VanillaCE extends HTMLElement {
  connectedCallback() {
    this.textContent = 'vanilla';
  }
}
customElements.define('vanilla-ce', VanillaCE);
`;
      const res = transformNative(input);
      expect(res.vanillaCount).toBe(0);
      expect(res.code).toContain('class VanillaCE extends HTMLElement');
      const matches = res.code.match(/customElements\.define\(['"]vanilla-ce['"],\s*VanillaCE\)/g);
      expect(matches).toHaveLength(1);
    });
  });

  // =========================================================================
  // FOCUS AREA 4: REAL COMPONENT EXECUTION ACROSS 5 DESIGN SYSTEMS
  // =========================================================================
  describe('focus area 4: real component execution across Carbon, Spectrum, Web Awesome, Material, and Momentum', () => {
    const suites = [
      { name: 'Carbon', list: CARBON_COMPONENTS },
      { name: 'Spectrum', list: SPECTRUM_COMPONENTS },
      { name: 'Web Awesome', list: WEBAWESOME_COMPONENTS },
      { name: 'Material Web', list: MATERIAL_COMPONENTS },
      { name: 'Momentum', list: MOMENTUM_COMPONENTS },
    ];

    suites.forEach(({ name, list }) => {
      it(`classifies real components from ${name} without errors`, () => {
        let validComponents = 0;
        for (const comp of list.slice(0, 5)) {
          const raw = readComponentSource(comp.pkg, comp.source);
          if (raw) {
            const results = classify(raw, { filename: comp.source });
            expect(Array.isArray(results)).toBe(true);
            validComponents++;
          }
        }
        expect(validComponents).toBeGreaterThan(0);
      });
    });
  });
});
