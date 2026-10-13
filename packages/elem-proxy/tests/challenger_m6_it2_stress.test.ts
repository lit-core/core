import { describe, expect, it } from 'vitest';
import { transformElemProxy } from '../src/index.js';

function prepareRunnableCode(code: string): string {
  return code
    .replace(/import [^;]+;/g, '')
    .replace(/export\s+default\s+/g, '')
    .replace(/export\s+class\s+/g, 'class ')
    .replace(/export\s+\{[^}]+\};?/g, '');
}

describe('empirical challenger m6 iteration 2 elem-proxy stress battery', () => {
  // =========================================================================
  // SECTION 1: DIRECT REPRODUCTION VERIFICATION FROM WORKER RETRY HANDOFF § 4
  // =========================================================================
  describe('direct worker reproduction scenario', () => {
    it('verifies exact recorded attributes from handoff § 4', () => {
      const input = `
import { LitElement } from 'lit';
export class AttrBufferEl extends LitElement {
  static properties = { theme: { type: String, attribute: 'data-theme' } };
  attributeChangedCallback(name, oldVal, newVal) {
    if (!this._attrHistory) this._attrHistory = [];
    this._attrHistory.push({ name, oldVal, newVal });
  }
}
customElements.define('attr-buffer-el', AttrBufferEl);
`;
      const res = transformElemProxy(input);
      const runnable = prepareRunnableCode(res.code);
      let Reg: any = null;
      class MockHTMLElement {
        isConnected = false;
      }
      class MockLitElement extends MockHTMLElement {
        static finalize() {}
      }
      const fn = new Function('HTMLElement', 'LitElement', 'customElements', runnable);
      fn(MockHTMLElement, MockLitElement, {
        define: (_t: string, cls: any) => {
          Reg = cls;
        },
      });

      expect(Reg).not.toBeNull();
      const inst = new Reg();
      inst.attributeChangedCallback('data-theme', null, 'dark');
      inst.isConnected = true;
      inst.connectedCallback();

      expect(inst._attrHistory).toEqual([{ name: 'data-theme', oldVal: null, newVal: 'dark' }]);
    });
  });

  // =========================================================================
  // SECTION 2: MULTI-ELEMENT PRE-CONNECTION BUFFERING & ISOLATION
  // =========================================================================
  describe('multi-element buffering across multiple custom elements', () => {
    it('buffers and replays attributes independently across multiple custom elements in one module', () => {
      const input = `
import { LitElement } from 'lit';

export class HeaderEl extends LitElement {
  static properties = {
    title: { type: String, attribute: 'title' },
    level: { type: Number, attribute: 'level' },
  };
  attributeChangedCallback(name, oldVal, newVal) {
    if (!this._history) this._history = [];
    this._history.push({ name, oldVal, newVal });
  }
}
customElements.define('app-header', HeaderEl);

export class SidebarEl extends LitElement {
  static properties = {
    collapsed: { type: Boolean, attribute: 'collapsed' },
    width: { type: String, attribute: 'width' },
  };
  attributeChangedCallback(name, oldVal, newVal) {
    if (!this._history) this._history = [];
    this._history.push({ name, oldVal, newVal });
  }
}
customElements.define('app-sidebar', SidebarEl);

export class FooterEl extends LitElement {
  static properties = {
    year: { type: String, attribute: 'year' },
  };
  attributeChangedCallback(name, oldVal, newVal) {
    if (!this._history) this._history = [];
    this._history.push({ name, oldVal, newVal });
  }
}
customElements.define('app-footer', FooterEl);
`;
      const res = transformElemProxy(input);
      expect(res.proxiedElementsCount).toBe(3);

      const registry: Record<string, any> = {};
      class MockHTMLElement {
        isConnected = false;
      }
      class MockLitElement extends MockHTMLElement {
        static finalize() {}
      }

      const runnable = prepareRunnableCode(res.code);
      const fn = new Function('HTMLElement', 'LitElement', 'customElements', runnable);
      fn(MockHTMLElement, MockLitElement, {
        define: (tag: string, cls: any) => {
          registry[tag] = cls;
        },
      });

      expect(registry['app-header']).toBeDefined();
      expect(registry['app-sidebar']).toBeDefined();
      expect(registry['app-footer']).toBeDefined();

      const headerInst = new registry['app-header']();
      const sidebarInst = new registry['app-sidebar']();
      const footerInst = new registry['app-footer']();

      // Buffer attributes across all three elements prior to connection
      headerInst.attributeChangedCallback('title', null, 'My Dashboard');
      headerInst.attributeChangedCallback('level', null, '1');

      sidebarInst.attributeChangedCallback('collapsed', null, 'true');
      sidebarInst.attributeChangedCallback('width', null, '280px');

      footerInst.attributeChangedCallback('year', null, '2026');

      // Verify no replay before upgrade
      expect(headerInst._history).toBeUndefined();
      expect(sidebarInst._history).toBeUndefined();
      expect(footerInst._history).toBeUndefined();

      // Upgrade Header via connectedCallback
      headerInst.isConnected = true;
      headerInst.connectedCallback();

      // Upgrade Sidebar via property read trigger
      expect(sidebarInst.collapsed).toBeUndefined();

      // Upgrade Footer via property write trigger
      footerInst.year = '2027';

      // Check header history
      expect(headerInst._history).toEqual([
        { name: 'title', oldVal: null, newVal: 'My Dashboard' },
        { name: 'level', oldVal: null, newVal: '1' },
      ]);

      // Check sidebar history (triggered by property read)
      expect(sidebarInst._history).toEqual([
        { name: 'collapsed', oldVal: null, newVal: 'true' },
        { name: 'width', oldVal: null, newVal: '280px' },
      ]);

      // Check footer history (triggered by property write)
      expect(footerInst._history).toEqual([{ name: 'year', oldVal: null, newVal: '2026' }]);

      // Connecting sidebar and footer after property upgrade must NOT re-replay
      sidebarInst.isConnected = true;
      sidebarInst.connectedCallback();
      expect(sidebarInst._history.length).toBe(2);

      footerInst.isConnected = true;
      footerInst.connectedCallback();
      expect(footerInst._history.length).toBe(1);
    });
  });

  // =========================================================================
  // SECTION 3: MULTIPLE INSTANCES OF THE SAME COMPONENT
  // =========================================================================
  describe('instance state isolation and buffer independence', () => {
    it('ensures independent attribute buffers across separate instances of the same element', () => {
      const input = `
import { LitElement } from 'lit';
export class CardEl extends LitElement {
  static properties = {
    variant: { type: String, attribute: 'variant' },
    elevation: { type: Number, attribute: 'elevation' },
  };
  attributeChangedCallback(name, oldVal, newVal) {
    if (!this._history) this._history = [];
    this._history.push({ name, oldVal, newVal });
  }
}
customElements.define('ui-card', CardEl);
`;
      const res = transformElemProxy(input);
      let CardClass: any = null;
      class MockHTMLElement {
        isConnected = false;
      }
      class MockLitElement extends MockHTMLElement {
        static finalize() {}
      }
      const runnable = prepareRunnableCode(res.code);
      const fn = new Function('HTMLElement', 'LitElement', 'customElements', runnable);
      fn(MockHTMLElement, MockLitElement, {
        define: (_t: string, cls: any) => {
          CardClass = cls;
        },
      });

      const inst1 = new CardClass();
      const inst2 = new CardClass();
      const inst3 = new CardClass();

      // Instance 1 gets variant=elevated, elevation=2
      inst1.attributeChangedCallback('variant', null, 'elevated');
      inst1.attributeChangedCallback('elevation', null, '2');

      // Instance 2 gets variant=flat
      inst2.attributeChangedCallback('variant', null, 'flat');

      // Instance 3 gets no attributes

      // Connect instance 1
      inst1.isConnected = true;
      inst1.connectedCallback();

      expect(inst1._history).toEqual([
        { name: 'variant', oldVal: null, newVal: 'elevated' },
        { name: 'elevation', oldVal: null, newVal: '2' },
      ]);
      expect(inst2._history).toBeUndefined();
      expect(inst3._history).toBeUndefined();

      // Connect instance 2
      inst2.isConnected = true;
      inst2.connectedCallback();

      expect(inst2._history).toEqual([{ name: 'variant', oldVal: null, newVal: 'flat' }]);
      expect(inst3._history).toBeUndefined();

      // Connect instance 3
      inst3.isConnected = true;
      inst3.connectedCallback();

      expect(inst3._history).toBeUndefined();
    });
  });

  // =========================================================================
  // SECTION 4: PRE-CONNECTION ATTRIBUTE REWRITES AND MAP SEMANTICS
  // =========================================================================
  describe('attribute overwrites and map semantics prior to connection', () => {
    it('preserves latest attribute values when the same attribute is updated multiple times before upgrade', () => {
      const input = `
import { LitElement } from 'lit';
export class ToggleEl extends LitElement {
  static properties = {
    state: { type: String, attribute: 'data-state' },
    mode: { type: String, attribute: 'data-mode' },
  };
  attributeChangedCallback(name, oldVal, newVal) {
    if (!this._history) this._history = [];
    this._history.push({ name, oldVal, newVal });
  }
}
customElements.define('ui-toggle', ToggleEl);
`;
      const res = transformElemProxy(input);
      let ToggleClass: any = null;
      class MockHTMLElement {
        isConnected = false;
      }
      class MockLitElement extends MockHTMLElement {
        static finalize() {}
      }
      const runnable = prepareRunnableCode(res.code);
      const fn = new Function('HTMLElement', 'LitElement', 'customElements', runnable);
      fn(MockHTMLElement, MockLitElement, {
        define: (_t: string, cls: any) => {
          ToggleClass = cls;
        },
      });

      const inst = new ToggleClass();

      // Update state multiple times
      inst.attributeChangedCallback('data-state', null, 'pending');
      inst.attributeChangedCallback('data-mode', null, 'manual');
      inst.attributeChangedCallback('data-state', 'pending', 'active');
      inst.attributeChangedCallback('data-mode', 'manual', 'automatic');
      inst.attributeChangedCallback('data-state', 'active', 'complete');

      // Upgrade
      inst.isConnected = true;
      inst.connectedCallback();

      // Buffer uses Map semantics: only latest value per attribute is buffered
      expect(inst._history).toEqual([
        { name: 'data-state', oldVal: null, newVal: 'complete' },
        { name: 'data-mode', oldVal: null, newVal: 'automatic' },
      ]);
    });
  });

  // =========================================================================
  // SECTION 5: LIFECYCLE SEQUENCES: PRE, UPGRADE, POST, DISCONNECT, RECONNECT
  // =========================================================================
  describe('complex lifecycle sequences', () => {
    it('handles full lifecycle: pre-connection, upgrade, post-upgrade mutation, disconnect, reconnect', () => {
      const input = `
import { LitElement } from 'lit';
export class LifecycleEl extends LitElement {
  static properties = {
    status: { type: String, attribute: 'status' },
  };
  attributeChangedCallback(name, oldVal, newVal) {
    if (!this._events) this._events = [];
    this._events.push({ type: 'attr', name, oldVal, newVal });
  }
  connectedCallback() {
    if (!this._events) this._events = [];
    this._events.push({ type: 'connected' });
  }
  disconnectedCallback() {
    if (!this._events) this._events = [];
    this._events.push({ type: 'disconnected' });
  }
}
customElements.define('lifecycle-el', LifecycleEl);
`;
      const res = transformElemProxy(input);
      let LifecycleClass: any = null;
      class MockHTMLElement {
        isConnected = false;
        disconnectedCallback() {}
      }
      class MockLitElement extends MockHTMLElement {
        static finalize() {}
      }
      const runnable = prepareRunnableCode(res.code);
      const fn = new Function('HTMLElement', 'LitElement', 'customElements', runnable);
      fn(MockHTMLElement, MockLitElement, {
        define: (_t: string, cls: any) => {
          LifecycleClass = cls;
        },
      });

      const inst = new LifecycleClass();

      // Step 1: Pre-connection attribute update
      inst.attributeChangedCallback('status', null, 'init');
      expect(inst._events).toBeUndefined();

      // Step 2: Connection triggers upgrade, flushes buffer, then connectedCallback
      inst.isConnected = true;
      inst.connectedCallback();

      expect(inst._events).toEqual([{ type: 'attr', name: 'status', oldVal: null, newVal: 'init' }, { type: 'connected' }]);

      // Step 3: Post-upgrade attribute mutation goes directly to RealClass callback
      inst.attributeChangedCallback('status', 'init', 'running');
      expect(inst._events).toEqual([{ type: 'attr', name: 'status', oldVal: null, newVal: 'init' }, { type: 'connected' }, { type: 'attr', name: 'status', oldVal: 'init', newVal: 'running' }]);

      // Step 4: Disconnect
      inst.isConnected = false;
      inst.disconnectedCallback();
      expect(inst._events[3]).toEqual({ type: 'disconnected' });

      // Step 5: Reconnect (must not re-flush old attributes)
      inst.isConnected = true;
      inst.connectedCallback();
      expect(inst._events[4]).toEqual({ type: 'connected' });
      expect(inst._events.length).toBe(5);
    });
  });

  // =========================================================================
  // SECTION 6: INHERITANCE ACROSS PROXIED CLASSES
  // =========================================================================
  describe('inheritance and prototype reflection across class hierarchies', () => {
    it('properly reflects base and derived prototype methods when upgraded', () => {
      const input = `
import { LitElement } from 'lit';

export class BaseWidget extends LitElement {
  static properties = {
    baseProp: { type: String, attribute: 'base-prop' },
  };
  baseMethod() {
    return 'from-base';
  }
  attributeChangedCallback(name, oldVal, newVal) {
    if (!this._attrLog) this._attrLog = [];
    this._attrLog.push({ name, oldVal, newVal });
  }
}

export class DerivedWidget extends BaseWidget {
  static properties = {
    derivedProp: { type: String, attribute: 'derived-prop' },
  };
  derivedMethod() {
    return 'from-derived';
  }
}
customElements.define('derived-widget', DerivedWidget);
`;
      const res = transformElemProxy(input);
      let DerivedClass: any = null;
      class MockHTMLElement {
        isConnected = false;
      }
      class MockLitElement extends MockHTMLElement {
        static finalize() {}
      }
      const runnable = prepareRunnableCode(res.code);
      const fn = new Function('HTMLElement', 'LitElement', 'customElements', runnable);
      fn(MockHTMLElement, MockLitElement, {
        define: (_t: string, cls: any) => {
          DerivedClass = cls;
        },
      });

      const inst = new DerivedClass();

      // Buffer attributes
      inst.attributeChangedCallback('base-prop', null, 'base-val');
      inst.attributeChangedCallback('derived-prop', null, 'derived-val');

      // Upgrade
      inst.isConnected = true;
      inst.connectedCallback();

      // Check methods from both levels of the hierarchy
      expect(typeof inst.baseMethod).toBe('function');
      expect(inst.baseMethod()).toBe('from-base');
      expect(typeof inst.derivedMethod).toBe('function');
      expect(inst.derivedMethod()).toBe('from-derived');

      // Check attribute callback execution
      expect(inst._attrLog).toEqual([
        { name: 'base-prop', oldVal: null, newVal: 'base-val' },
        { name: 'derived-prop', oldVal: null, newVal: 'derived-val' },
      ]);
    });
  });

  // =========================================================================
  // SECTION 7: EDGE VALUE HANDLING
  // =========================================================================
  describe('edge value handling in attribute buffer', () => {
    it('handles empty string, null, and unicode string attribute values', () => {
      const input = `
import { LitElement } from 'lit';
export class SpecialAttrEl extends LitElement {
  static properties = {
    empty: { type: String, attribute: 'empty-attr' },
    unicode: { type: String, attribute: 'unicode-attr' },
    removed: { type: String, attribute: 'removed-attr' },
  };
  attributeChangedCallback(name, oldVal, newVal) {
    if (!this._records) this._records = [];
    this._records.push({ name, oldVal, newVal });
  }
}
customElements.define('special-attr-el', SpecialAttrEl);
`;
      const res = transformElemProxy(input);
      let SpecialClass: any = null;
      class MockHTMLElement {
        isConnected = false;
      }
      class MockLitElement extends MockHTMLElement {
        static finalize() {}
      }
      const runnable = prepareRunnableCode(res.code);
      const fn = new Function('HTMLElement', 'LitElement', 'customElements', runnable);
      fn(MockHTMLElement, MockLitElement, {
        define: (_t: string, cls: any) => {
          SpecialClass = cls;
        },
      });

      const inst = new SpecialClass();
      inst.attributeChangedCallback('empty-attr', null, '');
      inst.attributeChangedCallback('unicode-attr', null, '✨ 🚀 💎');
      inst.attributeChangedCallback('removed-attr', 'prev', null);

      inst.isConnected = true;
      inst.connectedCallback();

      expect(inst._records).toEqual([
        { name: 'empty-attr', oldVal: null, newVal: '' },
        { name: 'unicode-attr', oldVal: null, newVal: '✨ 🚀 💎' },
        { name: 'removed-attr', oldVal: null, newVal: null },
      ]);
    });
  });
});
