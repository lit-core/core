import { describe, expect, it, vi } from 'vitest';
import { attachFormLifecycle, attachFormResetListener, findAssociatedForm, isElementFormDisabled, syncInputChecked, syncInputValue } from '../runtime/forms.js';
import { type MorphElementInternals, MorphHost } from '../runtime/morph-host.js';
import { compileModule } from '../src/index.js';

describe('milestone 5 challenger: empirical form facade and proxy stress testing', () => {
  // =========================================================================
  // 1. ElementInternals Facade API Compliance and Invariants
  // =========================================================================
  describe('1. ElementInternals facade API compliance and invariants', () => {
    it('empirically verifies setValidity throws TypeError when flags are set but message is missing or whitespace', () => {
      const host = new MorphHost();
      const internals = host.attachInternals() as unknown as MorphElementInternals;

      // WHATWG HTML 4.10.16.4: If flags has one or more members with value true,
      // and message is not given or is the empty string, then throw a TypeError.
      expect(() => {
        internals.setValidity({ valueMissing: true });
      }).toThrow(TypeError);

      expect(() => {
        internals.setValidity({ valueMissing: true }, '');
      }).toThrow(TypeError);

      expect(() => {
        internals.setValidity({ customError: true }, '   ');
      }).toThrow(TypeError);

      // Empty flags with empty message must NOT throw
      expect(() => {
        internals.setValidity({});
      }).not.toThrow();

      expect(() => {
        internals.setValidity({}, '');
      }).not.toThrow();

      // All flags false must NOT throw even if message is empty
      expect(() => {
        internals.setValidity({ valueMissing: false, customError: false }, '');
      }).not.toThrow();
    });

    it('empirically verifies all 10 ValidityState flags and valid boolean computation', () => {
      const host = new MorphHost();
      const internals = host.attachInternals() as unknown as MorphElementInternals;

      const flagKeys: (keyof ValidityStateFlags)[] = [
        'badInput',
        'customError',
        'patternMismatch',
        'rangeOverflow',
        'rangeUnderflow',
        'stepMismatch',
        'tooLong',
        'tooShort',
        'typeMismatch',
        'valueMissing',
      ];

      // Initially, control must be completely valid
      expect(internals.validity.valid).toBe(true);
      expect(internals.validationMessage).toBe('');
      for (const k of flagKeys) {
        expect(internals.validity[k as keyof ValidityState]).toBe(false);
      }

      // Test each flag individually
      for (const flag of flagKeys) {
        internals.setValidity({ [flag]: true }, `Failed validation for ${flag}`);
        expect(internals.validity.valid).toBe(false);
        expect(internals.validity[flag as keyof ValidityState]).toBe(true);
        expect(internals.validationMessage).toBe(`Failed validation for ${flag}`);

        // Verify all OTHER flags remain false
        for (const other of flagKeys) {
          if (other !== flag) {
            expect(internals.validity[other as keyof ValidityState]).toBe(false);
          }
        }
      }

      // Clearing validity restores valid: true and clears validationMessage
      internals.setValidity({});
      expect(internals.validity.valid).toBe(true);
      expect(internals.validationMessage).toBe('');
    });

    it('empirically verifies setFormValue handles null, undefined, primitive, and File objects', () => {
      const host = new MorphHost();
      const internals = host.attachInternals() as unknown as MorphElementInternals;

      // Mock proxy input
      const proxyInput = {
        value: 'initial',
        defaultValue: 'initial',
        files: null as any,
        setCustomValidity: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      } as any;
      host._proxyInput = proxyInput;

      // 1. Primitive string
      internals.setFormValue('hello world');
      expect(internals.formValue).toBe('hello world');
      expect(internals.formState).toBe('hello world');
      expect(proxyInput.value).toBe('hello world');
      expect(proxyInput.defaultValue).toBe('hello world');

      // 2. Number
      internals.setFormValue(42 as any);
      expect(internals.formValue).toBe(42);
      expect(proxyInput.value).toBe('42');
      expect(proxyInput.defaultValue).toBe('42');

      // 3. Boolean
      internals.setFormValue(true as any);
      expect(internals.formValue).toBe(true);
      expect(proxyInput.value).toBe('true');
      expect(proxyInput.defaultValue).toBe('true');

      // 4. Null & undefined (clears form value)
      internals.setFormValue(null);
      expect(internals.formValue).toBe(null);
      expect(proxyInput.value).toBe('');
      expect(proxyInput.defaultValue).toBe('');

      internals.setFormValue(undefined as any);
      expect(internals.formValue).toBe(undefined);
      expect(proxyInput.value).toBe('');
      expect(proxyInput.defaultValue).toBe('');

      // 5. Explicit state distinct from value
      internals.setFormValue('current_display_val', 'serialized_state_val');
      expect(internals.formValue).toBe('current_display_val');
      expect(internals.formState).toBe('serialized_state_val');
    });

    it('empirically enforces attachInternals idempotency guard (throws NotSupportedError on repeated call)', () => {
      const host = new MorphHost();
      const internals = host.attachInternals();
      expect(internals).toBeDefined();

      // Second call must throw DOMException('NotSupportedError') per WHATWG HTML 4.10.16.1
      expect(() => {
        host.attachInternals();
      }).toThrowError(/Failed to execute 'attachInternals'/);
    });

    it('empirically verifies shadowRoot, states, and labels accessors', () => {
      const host = new MorphHost();
      const internals = host.attachInternals() as unknown as MorphElementInternals;

      // In light DOM compilation, shadowRoot is null
      expect(internals.shadowRoot).toBeNull();

      // States is a CustomStateSet facade
      expect(internals.states).toBeDefined();
      internals.states.add('--checked');
      expect(internals.states.has('--checked')).toBe(true);
      internals.states.delete('--checked');
      expect(internals.states.has('--checked')).toBe(false);

      // Labels returns empty NodeList when unattached
      expect(internals.labels).toBeDefined();
    });
  });

  // =========================================================================
  // 2. AST Synthesis and Proxy Input Emission
  // =========================================================================
  describe('2. AST synthesis and proxy input emission', () => {
    it('synthesizes hidden proxy <input> with all required attributes for form-associated component', () => {
      const code = `
        import { LitElement, html, property } from 'lit';

        export class StarRating extends LitElement {
          static formAssociated = true;
          private _internals: ElementInternals;

          @property({ type: Number })
          score = 5;

          constructor() {
            super();
            this._internals = this.attachInternals();
          }

          render() {
            return html\`<div>Score: \${this.score}</div>\`;
          }
        }
      `;

      const res = compileModule(code, { filePath: 'star-rating.ts' });
      expect(res.tier).toBe('Tier2HostedWithFacade');

      // Verify proxy input emission in generated JSX
      expect(res.code).toContain('<input');
      expect(res.code).toContain('ref={host._proxyInputRef}');
      expect(res.code).toContain('name={props.name}');
      expect(res.code).toContain('disabled={props.disabled}');
      expect(res.code).toContain('tabIndex={-1}');
      expect(res.code).toContain('aria-hidden="true"');
      expect(res.code).toContain('style={_proxyInputStyle}');

      // Verify _proxyInputStyle import from runtime
      expect(res.code).toContain('_proxyInputStyle');
    });

    it('identifies minified static formAssociated = !0 and emits Tier 2 proxy input', () => {
      const code = `
        import { LitElement as L, html as h, property as p } from 'lit';

        export class MinifiedControl extends L {
          static formAssociated = !0;
          render() {
            return h\`<div>control</div>\`;
          }
        }
      `;

      const res = compileModule(code, { filePath: 'minified-control.ts' });
      expect(res.tier).toBe('Tier2HostedWithFacade');
      expect(res.code).toContain('ref={host._proxyInputRef}');
      expect(res.code).toContain('style={_proxyInputStyle}');
    });

    it('carries over author non-static class fields to component host class', () => {
      const code = `
        import { LitElement, html } from 'lit';

        export class CustomFieldControl extends LitElement {
          static formAssociated = true;
          customAuthorField = 'persisted_field_value';
          customAuthorMethod() {
            return 'called';
          }

          render() {
            return html\`<div>field</div>\`;
          }
        }
      `;

      const res = compileModule(code, { filePath: 'custom-field-control.ts' });
      expect(res.tier).toBe('Tier2HostedWithFacade');
      expect(res.code).toContain('customAuthorField');
      expect(res.code).toContain('customAuthorMethod');
    });
  });

  // =========================================================================
  // 3. WHATWG Fieldset Disabled and Legend Exemption Hierarchy
  // =========================================================================
  describe('3. WHATWG fieldset disabled and legend exemption hierarchy', () => {
    it('returns true when element has own disabled attribute or prop', () => {
      const el = {
        hasAttribute: (attr: string) => attr === 'disabled',
        parentElement: null,
      } as any;

      expect(isElementFormDisabled(el, false)).toBe(true);
      expect(isElementFormDisabled(null, true)).toBe(true);
    });

    it('disables element inside disabled fieldset without legend', () => {
      const fieldset = {
        tagName: 'FIELDSET',
        hasAttribute: (attr: string) => attr === 'disabled',
        querySelector: (_sel: string) => null,
        parentElement: null,
      } as any;

      const el = {
        hasAttribute: (_attr: string) => false,
        parentElement: fieldset,
      } as any;

      expect(isElementFormDisabled(el, false)).toBe(true);
    });

    it('exempts element inside FIRST legend of disabled fieldset per WHATWG 4.10.19', () => {
      const firstLegend = {
        tagName: 'LEGEND',
        contains: (target: any) => target === el,
      } as any;

      const fieldset = {
        tagName: 'FIELDSET',
        hasAttribute: (attr: string) => attr === 'disabled',
        querySelector: (sel: string) => (sel === 'legend' ? firstLegend : null),
        parentElement: null,
      } as any;

      firstLegend.parentElement = fieldset;

      const el: any = {
        hasAttribute: (_attr: string) => false,
        parentElement: firstLegend,
      };

      // Descendant of first legend must NOT be disabled
      expect(isElementFormDisabled(el, false)).toBe(false);
    });

    it('does NOT exempt element inside SECOND legend of disabled fieldset', () => {
      const firstLegend = {
        tagName: 'LEGEND',
        contains: (_target: any) => false,
      } as any;

      const secondLegend = {
        tagName: 'LEGEND',
        contains: (target: any) => target === el,
      } as any;

      const fieldset = {
        tagName: 'FIELDSET',
        hasAttribute: (attr: string) => attr === 'disabled',
        // querySelector returns only the first legend
        querySelector: (sel: string) => (sel === 'legend' ? firstLegend : null),
        parentElement: null,
      } as any;

      firstLegend.parentElement = fieldset;
      secondLegend.parentElement = fieldset;

      const el: any = {
        hasAttribute: (_attr: string) => false,
        parentElement: secondLegend,
      };

      // Descendant of second legend must be disabled
      expect(isElementFormDisabled(el, false)).toBe(true);
    });

    it('evaluates deeply nested fieldsets with legend exemptions accurately', () => {
      // Structure:
      // <fieldset disabled (outer)>
      //   <legend (first of outer)>
      //     <fieldset (inner)>
      //       <element />
      //     </fieldset>
      //   </legend>
      // </fieldset>
      const innerFieldset: any = {
        tagName: 'FIELDSET',
        hasAttribute: (_attr: string) => false,
        parentElement: null,
      };

      const outerFirstLegend: any = {
        tagName: 'LEGEND',
        contains: (target: any) => target === el || target === innerFieldset,
      };

      const outerFieldset: any = {
        tagName: 'FIELDSET',
        hasAttribute: (attr: string) => attr === 'disabled',
        querySelector: (sel: string) => (sel === 'legend' ? outerFirstLegend : null),
        parentElement: null,
      };

      innerFieldset.parentElement = outerFirstLegend;
      outerFirstLegend.parentElement = outerFieldset;

      const el: any = {
        hasAttribute: (_attr: string) => false,
        parentElement: innerFieldset,
      };

      // Since innerFieldset is inside outer's first legend, element is exempt
      expect(isElementFormDisabled(el, false)).toBe(false);
    });
  });

  // =========================================================================
  // 4. Constraint Validation Forwarding and Focus Redirection
  // =========================================================================
  describe('4. constraint validation forwarding and focus redirection', () => {
    it('safely handles missing HTMLElement in Node SSR without throwing ReferenceError', () => {
      const origHTMLElement = (globalThis as any).HTMLElement;
      delete (globalThis as any).HTMLElement;

      try {
        const host = new MorphHost();
        const internals = host.attachInternals() as unknown as MorphElementInternals;

        const focusSpy = vi.fn();
        const anchorNode = {
          tabIndex: 0,
          hasAttribute: () => true,
          focus: focusSpy,
        } as any;

        internals.setValidity({ valueMissing: true }, 'Required', anchorNode);

        // In Node without HTMLElement global, reportValidity must safely redirect focus without throwing ReferenceError
        expect(() => {
          const isValid = internals.reportValidity();
          expect(isValid).toBe(false);
        }).not.toThrow();
        expect(focusSpy).toHaveBeenCalledTimes(1);
      } finally {
        (globalThis as any).HTMLElement = origHTMLElement;
      }
    });

    it('redirects focus to custom validation anchor element during reportValidity when HTMLElement is defined', () => {
      const origHTMLElement = (globalThis as any).HTMLElement;
      class FakeHTMLElement {}
      (globalThis as any).HTMLElement = FakeHTMLElement;

      try {
        const host = new MorphHost();
        const internals = host.attachInternals() as unknown as MorphElementInternals;

        const focusSpy = vi.fn();
        const anchorNode = Object.assign(new FakeHTMLElement(), {
          tabIndex: 0,
          hasAttribute: (_attr: string) => true,
          focus: focusSpy,
        });

        internals.setValidity({ valueMissing: true }, 'Required field', anchorNode as any);
        expect(internals.validity.valid).toBe(false);

        const isValid = internals.reportValidity();
        expect(isValid).toBe(false);
        expect(focusSpy).toHaveBeenCalledTimes(1);
      } finally {
        (globalThis as any).HTMLElement = origHTMLElement;
      }
    });

    it('redirects focus to host element with tabIndex=-1 when no anchor is provided', () => {
      const origHTMLElement = (globalThis as any).HTMLElement;
      class FakeHTMLElement {}
      (globalThis as any).HTMLElement = FakeHTMLElement;

      try {
        const host = new MorphHost();
        const internals = host.attachInternals() as unknown as MorphElementInternals;

        let hostTabIndex: number | undefined;
        const hostFocusSpy = vi.fn();
        const hostElement = Object.assign(new FakeHTMLElement(), {
          get tabIndex() {
            return hostTabIndex ?? -1;
          },
          set tabIndex(val: number) {
            hostTabIndex = val;
          },
          hasAttribute: (attr: string) => (attr === 'tabindex' ? hostTabIndex !== undefined : false),
          focus: hostFocusSpy,
          dispatchEvent: vi.fn().mockReturnValue(true),
        });

        host._hostElement = hostElement as any;

        internals.setValidity({ customError: true }, 'Custom failure');
        expect(internals.validity.valid).toBe(false);

        const isValid = internals.reportValidity();
        expect(isValid).toBe(false);
        expect(hostFocusSpy).toHaveBeenCalledTimes(1);
        expect(hostElement.tabIndex).toBe(-1);
      } finally {
        (globalThis as any).HTMLElement = origHTMLElement;
      }
    });

    it('dispatches synthetic cancelable invalid event on checkValidity failure', () => {
      const host = new MorphHost();
      const internals = host.attachInternals() as unknown as MorphElementInternals;

      let dispatchedEvent: any = null;
      host._hostElement = {
        hasAttribute: vi.fn().mockReturnValue(false),
        dispatchEvent: vi.fn((e: any) => {
          dispatchedEvent = e;
          return true;
        }),
      } as any;

      internals.setValidity({ badInput: true }, 'Bad number');
      const isValid = host.checkValidity();

      expect(isValid).toBe(false);
      expect(dispatchedEvent).toBeDefined();
      expect(dispatchedEvent.type).toBe('invalid');
      expect(dispatchedEvent.cancelable).toBe(true);
      expect(dispatchedEvent.bubbles).toBe(false);
    });

    it('syncs validity to proxy input via setCustomValidity', () => {
      const host = new MorphHost();
      const internals = host.attachInternals() as unknown as MorphElementInternals;

      const setCustomValiditySpy = vi.fn();
      host._proxyInput = {
        setCustomValidity: setCustomValiditySpy,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      } as any;

      internals.setValidity({ typeMismatch: true }, 'Invalid email format');
      expect(setCustomValiditySpy).toHaveBeenCalledWith('Invalid email format');

      internals.setValidity({});
      expect(setCustomValiditySpy).toHaveBeenCalledWith('');
    });
  });

  // =========================================================================
  // 5. Form Association and Reset Lifecycle
  // =========================================================================
  describe('5. form association and reset lifecycle', () => {
    it('resolves associated form element via form attribute id first, falling back to closest form', () => {
      const origDoc = (globalThis as any).document;
      const origForm = (globalThis as any).HTMLFormElement;

      class FakeFormElement {
        tagName = 'FORM';
        id = 'external-form';
      }
      (globalThis as any).HTMLFormElement = FakeFormElement;

      const externalForm = new FakeFormElement();
      const fakeDoc = {
        getElementById: vi.fn((id: string) => (id === 'external-form' ? externalForm : null)),
      };
      (globalThis as any).document = fakeDoc;

      try {
        const elementWithFormAttr = {
          getAttribute: (attr: string) => (attr === 'form' ? 'external-form' : null),
          ownerDocument: fakeDoc,
          closest: vi.fn(),
        } as any;

        const resolved = findAssociatedForm(elementWithFormAttr);
        expect(resolved).toBe(externalForm);
        expect(elementWithFormAttr.closest).not.toHaveBeenCalled();

        // Fallback to closest('form') when form attribute is absent
        const parentForm = new FakeFormElement();
        parentForm.id = 'parent-form';

        const elementWithoutAttr = {
          getAttribute: (_attr: string) => null,
          ownerDocument: fakeDoc,
          closest: vi.fn((sel: string) => (sel === 'form' ? parentForm : null)),
        } as any;

        const fallbackResolved = findAssociatedForm(elementWithoutAttr);
        expect(fallbackResolved).toBe(parentForm);
        expect(elementWithoutAttr.closest).toHaveBeenCalledWith('form');
      } finally {
        (globalThis as any).document = origDoc;
        (globalThis as any).HTMLFormElement = origForm;
      }
    });

    it('attaches and cleans up form reset listener cleanly', () => {
      const resetCallbacks: (() => void)[] = [];
      const form = {
        tagName: 'FORM',
        addEventListener: vi.fn((evt: string, cb: any) => {
          if (evt === 'reset') resetCallbacks.push(cb);
        }),
        removeEventListener: vi.fn((evt: string, cb: any) => {
          if (evt === 'reset') {
            const idx = resetCallbacks.indexOf(cb);
            if (idx >= 0) resetCallbacks.splice(idx, 1);
          }
        }),
      } as any;

      const element = {
        getAttribute: (_attr: string) => null,
        closest: vi.fn(() => form),
      } as any;

      const callbackSpy = vi.fn();
      const cleanup = attachFormResetListener(element, callbackSpy);

      expect(form.addEventListener).toHaveBeenCalledWith('reset', expect.any(Function));
      expect(resetCallbacks.length).toBe(1);

      // Trigger reset callback
      resetCallbacks[0]();
      expect(callbackSpy).toHaveBeenCalledTimes(1);

      // Cleanup
      cleanup();
      expect(form.removeEventListener).toHaveBeenCalledWith('reset', expect.any(Function));
    });

    it('executes full attachFormLifecycle coordination with reset and disabled callbacks', () => {
      const host = new MorphHost();
      const formResetSpy = vi.fn();
      const formDisabledSpy = vi.fn();
      const formAssociatedSpy = vi.fn();

      (host as any).formResetCallback = formResetSpy;
      (host as any).formDisabledCallback = formDisabledSpy;
      (host as any).formAssociatedCallback = formAssociatedSpy;

      const resetListeners: (() => void)[] = [];
      const form = {
        tagName: 'FORM',
        addEventListener: vi.fn((_evt: string, cb: any) => resetListeners.push(cb)),
        removeEventListener: vi.fn(),
      } as any;

      const hostElement = {
        getAttribute: (_attr: string) => null,
        hasAttribute: (_attr: string) => false,
        closest: vi.fn(() => form),
        parentElement: null,
      } as any;

      const cleanup = attachFormLifecycle(host, hostElement, () => false);

      // formAssociatedCallback must be invoked with resolved form
      expect(formAssociatedSpy).toHaveBeenCalledWith(form);
      expect(host.form).toBe(form);

      // Trigger form reset
      expect(resetListeners.length).toBe(1);
      resetListeners[0]();
      expect(formResetSpy).toHaveBeenCalledTimes(1);

      // Cleanup must detach and notify formAssociatedCallback(null)
      cleanup();
      expect(formAssociatedSpy).toHaveBeenCalledWith(null);
      expect(host.form).toBeNull();
    });
  });

  // =========================================================================
  // 6. Value and Checked Input Synchronization
  // =========================================================================
  describe('6. value and checked input synchronization', () => {
    it('syncInputValue preserves cursor position when element is active', () => {
      let activeNode: any = null;
      const fakeDoc = {
        get activeElement() {
          return activeNode;
        },
      };
      const origDoc = (globalThis as any).document;
      (globalThis as any).document = fakeDoc;

      try {
        const input = {
          value: 'abcdef',
          selectionStart: 3,
          selectionEnd: 3,
          selectionDirection: 'forward',
          setSelectionRange: vi.fn(),
        } as any;

        activeNode = input;
        syncInputValue(input, 'abcXdef');

        expect(input.value).toBe('abcXdef');
        expect(input.setSelectionRange).toHaveBeenCalledWith(3, 3, 'forward');
      } finally {
        (globalThis as any).document = origDoc;
      }
    });

    it('syncInputChecked updates checked and indeterminate flags', () => {
      const checkbox = {
        checked: false,
        indeterminate: false,
      } as any;

      syncInputChecked(checkbox, true, true);
      expect(checkbox.checked).toBe(true);
      expect(checkbox.indeterminate).toBe(true);

      syncInputChecked(checkbox, false, false);
      expect(checkbox.checked).toBe(false);
      expect(checkbox.indeterminate).toBe(false);
    });
  });
});
