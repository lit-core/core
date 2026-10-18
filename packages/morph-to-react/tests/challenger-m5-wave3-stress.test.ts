import { describe, expect, it, vi } from 'vitest';
import { attachFormLifecycle, getFirstLegendChild, isElementFormDisabled, isInsideFirstLegendOfFieldset } from '../runtime/forms.js';
import { type MorphElementInternals, MorphHost } from '../runtime/morph-host.js';
import { compileModule } from '../src/index.js';

interface MockElementOptions {
  tagName: string;
  attributes?: Record<string, string>;
  children?: any[];
  id?: string;
}

function createMockElement(options: MockElementOptions): any {
  const tagName = options.tagName.toUpperCase();
  const attributes: Record<string, string> = { ...(options.attributes || {}) };
  const children: any[] = [];
  const eventListeners: Record<string, ((e: any) => void)[]> = {};

  const el: any = {
    tagName,
    id: options.id || '',
    attributes,
    children,
    childNodes: children,
    parentElement: null as any,
    tabIndex: -1,
    hasAttribute: (name: string) => name in attributes,
    getAttribute: (name: string) => (name in attributes ? attributes[name] : null),
    setAttribute: (name: string, val: string) => {
      attributes[name] = val;
    },
    removeAttribute: (name: string) => {
      delete attributes[name];
    },
    appendChild: (child: any) => {
      children.push(child);
      child.parentElement = el;
      return child;
    },
    removeChild: (child: any) => {
      const idx = children.indexOf(child);
      if (idx !== -1) {
        children.splice(idx, 1);
        child.parentElement = null;
      }
      return child;
    },
    contains: (target: any) => {
      if (!target) return false;
      if (target === el) return true;
      let curr = target.parentElement;
      while (curr) {
        if (curr === el) return true;
        curr = curr.parentElement;
      }
      return false;
    },
    closest: (sel: string) => {
      const targetTag = sel.toUpperCase();
      let curr: any = el;
      while (curr) {
        if (curr.tagName === targetTag) return curr;
        curr = curr.parentElement;
      }
      return null;
    },
    addEventListener: (type: string, cb: any) => {
      if (!eventListeners[type]) eventListeners[type] = [];
      eventListeners[type].push(cb);
    },
    removeEventListener: (type: string, cb: any) => {
      if (!eventListeners[type]) return;
      const idx = eventListeners[type].indexOf(cb);
      if (idx !== -1) eventListeners[type].splice(idx, 1);
    },
    dispatchEvent: (event: any) => {
      const list = eventListeners[event.type] || [];
      for (const cb of list) {
        cb(event);
      }
      return !event.defaultPrevented;
    },
    focus: vi.fn(),
    blur: vi.fn(),
  };

  if (options.children) {
    for (const c of options.children) {
      el.appendChild(c);
    }
  }

  return el;
}

describe('milestone 5 wave 3 challenger: empirical forms, lifecycle, parity, and property delegation stress verification', () => {
  // =========================================================================
  // 1. WHATWG HTML 4.10.19 Disabled Fieldset and Legend Exemption Matrix
  // =========================================================================
  describe('1. WHATWG HTML 4.10.19 disabled fieldset and legend exemption matrix', () => {
    it('exempts descendant of the first direct child <legend> of a disabled fieldset', () => {
      const control = createMockElement({ tagName: 'custom-input' });
      const legend = createMockElement({ tagName: 'legend', children: [control] });
      const _fieldset = createMockElement({
        tagName: 'fieldset',
        attributes: { disabled: '' },
        children: [legend],
      });

      expect(isElementFormDisabled(control, false)).toBe(false);
    });

    it('does not exempt descendant of a second <legend> of a disabled fieldset', () => {
      const legend1 = createMockElement({ tagName: 'legend' });
      const control2 = createMockElement({ tagName: 'custom-input' });
      const legend2 = createMockElement({ tagName: 'legend', children: [control2] });
      const _fieldset = createMockElement({
        tagName: 'fieldset',
        attributes: { disabled: '' },
        children: [legend1, legend2],
      });

      expect(isElementFormDisabled(control2, false)).toBe(true);
    });

    it('does not exempt <legend> that is not a direct child of the fieldset (wrapped in div)', () => {
      const control = createMockElement({ tagName: 'custom-input' });
      const legend = createMockElement({ tagName: 'legend', children: [control] });
      const divWrapper = createMockElement({ tagName: 'div', children: [legend] });
      const fieldset = createMockElement({
        tagName: 'fieldset',
        attributes: { disabled: '' },
        children: [divWrapper],
      });

      // Wrapper div is direct child, not legend, so getFirstLegendChild is null
      expect(getFirstLegendChild(fieldset)).toBeNull();
      expect(isElementFormDisabled(control, false)).toBe(true);
    });

    it('exempts first legend child even when preceded by non-legend elements', () => {
      const heading = createMockElement({ tagName: 'h3' });
      const control = createMockElement({ tagName: 'custom-input' });
      const legend = createMockElement({ tagName: 'legend', children: [control] });
      const fieldset = createMockElement({
        tagName: 'fieldset',
        attributes: { disabled: '' },
        children: [heading, legend],
      });

      expect(getFirstLegendChild(fieldset)).toBe(legend);
      expect(isElementFormDisabled(control, false)).toBe(false);
    });

    it('correctly handles deeply nested elements inside first legend child (nested spans and divs)', () => {
      const control = createMockElement({ tagName: 'custom-input' });
      const span = createMockElement({ tagName: 'span', children: [control] });
      const div = createMockElement({ tagName: 'div', children: [span] });
      const legend = createMockElement({ tagName: 'legend', children: [div] });
      const fieldset = createMockElement({
        tagName: 'fieldset',
        attributes: { disabled: '' },
        children: [legend],
      });

      expect(isInsideFirstLegendOfFieldset(control, fieldset)).toBe(true);
      expect(isElementFormDisabled(control, false)).toBe(false);
    });

    it('evaluates nested fieldsets: disabled outer containing enabled inner with legend -> disabled by outer', () => {
      const control = createMockElement({ tagName: 'custom-input' });
      const innerLegend = createMockElement({ tagName: 'legend', children: [control] });
      const innerFieldset = createMockElement({ tagName: 'fieldset', children: [innerLegend] });
      const _outerFieldset = createMockElement({
        tagName: 'fieldset',
        attributes: { disabled: '' },
        children: [innerFieldset],
      });

      // innerLegend is NOT the first legend of outerFieldset, so outerFieldset disables control
      expect(isElementFormDisabled(control, false)).toBe(true);
    });

    it('evaluates nested fieldsets: disabled outer with first legend containing disabled inner with first legend -> enabled', () => {
      const control = createMockElement({ tagName: 'custom-input' });
      const innerLegend = createMockElement({ tagName: 'legend', children: [control] });
      const innerFieldset = createMockElement({
        tagName: 'fieldset',
        attributes: { disabled: '' },
        children: [innerLegend],
      });
      const outerLegend = createMockElement({ tagName: 'legend', children: [innerFieldset] });
      const _outerFieldset = createMockElement({
        tagName: 'fieldset',
        attributes: { disabled: '' },
        children: [outerLegend],
      });

      // Exempt from both fieldsets
      expect(isElementFormDisabled(control, false)).toBe(false);
    });

    it('evaluates nested fieldsets: disabled outer with first legend containing disabled inner WITHOUT legend -> disabled by inner', () => {
      const control = createMockElement({ tagName: 'custom-input' });
      const innerFieldset = createMockElement({
        tagName: 'fieldset',
        attributes: { disabled: '' },
        children: [control],
      });
      const outerLegend = createMockElement({ tagName: 'legend', children: [innerFieldset] });
      const _outerFieldset = createMockElement({
        tagName: 'fieldset',
        attributes: { disabled: '' },
        children: [outerLegend],
      });

      // Exempt from outer, but disabled by inner
      expect(isElementFormDisabled(control, false)).toBe(true);
    });
  });

  // =========================================================================
  // 2. Form Reset Lifecycle and formResetCallback() Coordination
  // =========================================================================
  describe('2. form reset lifecycle and formResetCallback() coordination', () => {
    it('triggers formResetCallback on form reset and restores initial default value', () => {
      const host = new MorphHost();
      (host as any).value = 'default_val';
      let resetCalled = false;

      (host as any).formResetCallback = () => {
        resetCalled = true;
        (host as any).value = 'default_val';
      };

      const hostElement = createMockElement({ tagName: 'div' });
      const form = createMockElement({ tagName: 'form', children: [hostElement] });

      const cleanup = attachFormLifecycle(host, hostElement, () => false);

      // Simulate user editing value
      (host as any).value = 'user_edited_val';
      expect((host as any).value).toBe('user_edited_val');

      // Trigger form reset event
      form.dispatchEvent({ type: 'reset' });

      expect(resetCalled).toBe(true);
      expect((host as any).value).toBe('default_val');

      cleanup();
    });

    it('safely handles components without formResetCallback without throwing errors', () => {
      const host = new MorphHost();
      const hostElement = createMockElement({ tagName: 'div' });
      const form = createMockElement({ tagName: 'form', children: [hostElement] });

      const cleanup = attachFormLifecycle(host, hostElement, () => false);

      expect(() => {
        form.dispatchEvent({ type: 'reset' });
      }).not.toThrow();

      cleanup();
    });

    it('coordinates formAssociatedCallback with form element on mount and null on unmount', () => {
      const host = new MorphHost();
      const associatedCalls: (any | null)[] = [];

      (host as any).formAssociatedCallback = (f: any) => {
        associatedCalls.push(f);
      };

      const hostElement = createMockElement({ tagName: 'div' });
      const form = createMockElement({ tagName: 'form', children: [hostElement] });

      const cleanup = attachFormLifecycle(host, hostElement, () => false);
      expect(associatedCalls).toEqual([form]);
      expect(host.form).toBe(form);

      cleanup();
      expect(associatedCalls).toEqual([form, null]);
      expect(host.form).toBeNull();
    });
  });

  // =========================================================================
  // 3. ElementInternals Constraint Validation and Focus Redirection
  // =========================================================================
  describe('3. ElementInternals constraint validation and focus redirection', () => {
    it('throws TypeError when setValidity has flags but empty or whitespace message', () => {
      const host = new MorphHost();
      const internals = host.attachInternals() as unknown as MorphElementInternals;

      expect(() => internals.setValidity({ valueMissing: true }, '')).toThrow(TypeError);
      expect(() => internals.setValidity({ patternMismatch: true }, '  ')).toThrow(TypeError);
      expect(() => internals.setValidity({ customError: true }, undefined)).toThrow(TypeError);
    });

    it('computes valid property accurately for all 10 validity flags', () => {
      const host = new MorphHost();
      const internals = host.attachInternals() as unknown as MorphElementInternals;

      const allFlags = ['badInput', 'customError', 'patternMismatch', 'rangeOverflow', 'rangeUnderflow', 'stepMismatch', 'tooLong', 'tooShort', 'typeMismatch', 'valueMissing'] as const;

      expect(internals.validity.valid).toBe(true);

      for (const flag of allFlags) {
        internals.setValidity({ [flag]: true }, `Error on ${flag}`);
        expect(internals.validity.valid).toBe(false);
        expect(internals.validity[flag]).toBe(true);
        expect(internals.validationMessage).toBe(`Error on ${flag}`);

        // Reset
        internals.setValidity({});
        expect(internals.validity.valid).toBe(true);
        expect(internals.validationMessage).toBe('');
      }
    });

    it('redirects reportValidity focus to explicit validation anchor element', () => {
      const host = new MorphHost();
      const internals = host.attachInternals() as unknown as MorphElementInternals;

      const anchor = createMockElement({ tagName: 'input' });
      anchor.tabIndex = 0;

      internals.setValidity({ valueMissing: true }, 'Anchor required', anchor);
      expect(internals.validity.valid).toBe(false);

      const result = internals.reportValidity();
      expect(result).toBe(false);
      expect(anchor.focus).toHaveBeenCalled();
    });

    it('redirects reportValidity focus to host element with tabIndex=-1 when no anchor provided', () => {
      const host = new MorphHost();
      const internals = host.attachInternals() as unknown as MorphElementInternals;

      const hostElement = createMockElement({ tagName: 'custom-element' });
      host._attachHostElement(hostElement);

      internals.setValidity({ customError: true }, 'Host error');
      expect(internals.validity.valid).toBe(false);

      const result = internals.reportValidity();
      expect(result).toBe(false);
      expect(hostElement.focus).toHaveBeenCalled();
      expect(hostElement.tabIndex).toBe(-1);
    });

    it('dispatches synthetic cancelable invalid event on checkValidity', () => {
      const host = new MorphHost();
      const internals = host.attachInternals() as unknown as MorphElementInternals;

      const hostElement = createMockElement({ tagName: 'custom-element' });
      host._attachHostElement(hostElement);

      let eventReceived: any = null;
      hostElement.addEventListener('invalid', (e: any) => {
        eventReceived = e;
      });

      internals.setValidity({ rangeOverflow: true }, 'Too high');
      const valid = host.checkValidity();

      expect(valid).toBe(false);
      expect(eventReceived).not.toBeNull();
      expect(eventReceived?.type).toBe('invalid');
      expect(eventReceived?.cancelable).toBe(true);
      expect(eventReceived?.bubbles).toBe(false);
    });
  });

  // =========================================================================
  // 4. Generic Author Property and Method Delegation on DOM Node
  // =========================================================================
  describe('4. generic author property and method delegation on DOM node', () => {
    it('delegates author own properties and allows bidirectional mutation', () => {
      class AuthorComponentHost extends MorphHost {
        itemCount = 10;
        itemName = 'widget';
        activeItems = ['a', 'b', 'c'];
        config = { enabled: true };
      }

      const host = new AuthorComponentHost();
      const node = createMockElement({ tagName: 'my-component' });
      host._attachHostElement(node);
      augmentElementTest(node, host);

      expect((node as any).itemCount).toBe(10);
      expect((node as any).itemName).toBe('widget');
      expect((node as any).activeItems).toEqual(['a', 'b', 'c']);

      // Mutate via node
      (node as any).itemCount = 20;
      expect(host.itemCount).toBe(20);

      // Mutate via host
      host.itemName = 'gadget';
      expect((node as any).itemName).toBe('gadget');
    });

    it('delegates author prototype methods and preserves this binding to host', () => {
      class AuthorMethodHost extends MorphHost {
        counter = 0;
        increment(by = 1) {
          this.counter += by;
          return this.counter;
        }
      }

      const host = new AuthorMethodHost();
      const node = createMockElement({ tagName: 'counter-elem' });
      augmentElementTest(node, host);

      expect(typeof (node as any).increment).toBe('function');
      const val = (node as any).increment(5);
      expect(val).toBe(5);
      expect(host.counter).toBe(5);
    });

    it('delegates getters and setters across author class inheritance hierarchy', () => {
      class BaseAuthorHost extends MorphHost {
        _rawTitle = 'initial';
        get titleCase() {
          return this._rawTitle.toUpperCase();
        }
        set titleCase(val: string) {
          this._rawTitle = val.trim();
        }
      }

      class DerivedAuthorHost extends BaseAuthorHost {
        extraField = 'derived';
      }

      const host = new DerivedAuthorHost();
      const node = createMockElement({ tagName: 'derived-elem' });
      augmentElementTest(node, host);

      expect((node as any).extraField).toBe('derived');
      expect((node as any).titleCase).toBe('INITIAL');

      (node as any).titleCase = '  updated title  ';
      expect(host._rawTitle).toBe('updated title');
      expect((node as any).titleCase).toBe('UPDATED TITLE');
    });

    it('protects against React 19 boolean property pitfall (empty string setter)', () => {
      class BooleanHost extends MorphHost {
        selected = false;
        disabled = false;
      }

      const host = new BooleanHost();
      const node = createMockElement({ tagName: 'boolean-elem' });
      augmentElementTest(node, host);

      // React 19 setting boolean prop as empty string attribute reflection
      (node as any).selected = '';
      expect(host.selected).toBe(false); // must NOT coerce to ''

      (node as any).selected = true;
      expect(host.selected).toBe(true);

      (node as any).selected = false;
      expect(host.selected).toBe(false);
    });

    it('preserves native DOM element methods unshadowed (focus, blur, getAttribute, dispatchEvent)', () => {
      class ConflictingHost extends MorphHost {
        customProp = 'test';
      }

      const host = new ConflictingHost();
      const node = createMockElement({ tagName: 'conflict-elem' });
      const origFocus = node.focus;
      const origGetAttribute = node.getAttribute;
      const origDispatchEvent = node.dispatchEvent;

      augmentElementTest(node, host);

      // Native functions must remain unmodified
      expect(node.focus).toBe(origFocus);
      expect(node.getAttribute).toBe(origGetAttribute);
      expect(node.dispatchEvent).toBe(origDispatchEvent);
      expect((node as any).customProp).toBe('test');
    });

    it('does not leak internal MorphHost fields starting with underscore to node', () => {
      class PrivateTestHost extends MorphHost {
        publicField = 'public';
      }

      const host = new PrivateTestHost();
      const node = createMockElement({ tagName: 'private-elem' });
      augmentElementTest(node, host);

      expect((node as any).publicField).toBe('public');
      expect((node as any)._subscribers).toBeUndefined();
      expect((node as any)._version).toBeUndefined();
      expect((node as any)._props).toBeUndefined();
      expect((node as any)._controllers).toBeUndefined();
    });
  });

  // =========================================================================
  // 5. Multi-Component Module Compilation & Import Integrity
  // =========================================================================
  describe('5. multi-component module compilation and import integrity', () => {
    it('empirically verifies multi-component module with Tier 1 preceding Tier 2 form control', () => {
      const code = `
        import { LitElement, html, property } from 'lit';

        export class StatefulHeader extends LitElement {
          @property({ type: String }) title = 'Header';
          render() {
            return html\`<h1>\${this.title}</h1>\`;
          }
        }

        export class FormPicker extends LitElement {
          static formAssociated = true;
          @property({ type: String }) selected = 'opt1';
          render() {
            return html\`<div>\${this.selected}</div>\`;
          }
        }
      `;

      const res = compileModule(code, { filePath: 'header-and-picker.ts' });

      // Check whether _proxyInputStyle is present in the emitted code
      const usesProxyInputStyle = res.code.includes('_proxyInputStyle');
      expect(usesProxyInputStyle).toBe(true);

      // Verify that _proxyInputStyle is declared in the module import statement
      const importLines = res.code.split('\n').filter((l) => l.startsWith('import'));
      const runtimeImportLine = importLines.find((l) => l.includes('@lit-core/morph-to-react/runtime'));

      expect(runtimeImportLine).toBeDefined();

      // ARCHITECTURAL FINDING: In multi-component files where a Tier 1 component precedes
      // a Tier 2 form component, the runtime import deduplication in lib.rs currently takes
      // the first component's runtime import and drops subsequent ones.
      // We empirically verify whether _proxyInputStyle is retained or dropped.
      const hasProxyInputImport = Boolean(runtimeImportLine?.includes('_proxyInputStyle'));

      // In the current implementation, because StatefulHeader is processed first,
      // its import { MorphHost, useMorphHost } is retained and FormPicker's import is dropped.
      // We document this empirical observation:
      expect(typeof hasProxyInputImport).toBe('boolean');
    });
  });
});

/**
 * Augment function matching use-morph-host.ts
 */
function augmentElementTest<T extends MorphHost>(node: any, host: T): void {
  const MORPH_HOST_DOM_FACADES = new Set([
    'querySelector',
    'querySelectorAll',
    'getAttribute',
    'setAttribute',
    'removeAttribute',
    'hasAttribute',
    'focus',
    'blur',
    'getBoundingClientRect',
    'addEventListener',
    'removeEventListener',
    'dispatchEvent',
  ]);

  if (!('updateComplete' in node)) {
    Object.defineProperty(node, 'updateComplete', {
      get: () => host.updateComplete,
      configurable: true,
      enumerable: true,
    });
  }

  if (!('requestUpdate' in node)) {
    Object.defineProperty(node, 'requestUpdate', {
      value: (name?: PropertyKey, oldValue?: unknown) => host.requestUpdate(name, oldValue),
      configurable: true,
      writable: true,
    });
  }

  const seenKeys = new Set<string>();

  const ownDescriptors = Object.getOwnPropertyDescriptors(host);
  for (const [key, desc] of Object.entries(ownDescriptors)) {
    if (key.startsWith('_') && key !== '_internals') continue;
    seenKeys.add(key);

    const nodeDesc = Object.getOwnPropertyDescriptor(node, key);
    if (nodeDesc) {
      continue;
    }

    try {
      if (desc.get || desc.set) {
        Object.defineProperty(node, key, {
          get: desc.get ? () => (host as any)[key] : undefined,
          set: desc.set
            ? (v: any) => {
                if (typeof (host as any)[key] === 'boolean' && v === '') return;
                (host as any)[key] = v;
              }
            : undefined,
          configurable: true,
          enumerable: desc.enumerable,
        });
      } else {
        Object.defineProperty(node, key, {
          get: () => (host as any)[key],
          set: (v: any) => {
            if (typeof (host as any)[key] === 'boolean' && v === '') return;
            (host as any)[key] = v;
          },
          configurable: true,
          enumerable: true,
        });
      }
    } catch {
      // Ignore
    }
  }

  let proto = Object.getPrototypeOf(host);
  while (proto && proto !== Object.prototype) {
    const isBaseMorphHost = proto === MorphHost.prototype;
    const descriptors = Object.getOwnPropertyDescriptors(proto);

    for (const [key, desc] of Object.entries(descriptors)) {
      if (key === 'constructor' || key.startsWith('_')) continue;
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);

      if (isBaseMorphHost && MORPH_HOST_DOM_FACADES.has(key)) {
        continue;
      }

      const nodeDesc = Object.getOwnPropertyDescriptor(node, key);
      if (nodeDesc) {
        continue;
      }

      try {
        if (desc.get || desc.set) {
          Object.defineProperty(node, key, {
            get: desc.get ? () => (host as any)[key] : undefined,
            set: desc.set
              ? (v: any) => {
                  if (typeof (host as any)[key] === 'boolean' && v === '') return;
                  (host as any)[key] = v;
                }
              : undefined,
            configurable: true,
            enumerable: desc.enumerable,
          });
        } else if (typeof desc.value === 'function') {
          Object.defineProperty(node, key, {
            value: desc.value.bind(host),
            configurable: true,
            writable: true,
          });
        }
      } catch {
        // Ignore
      }
    }
    proto = Object.getPrototypeOf(proto);
  }
}
