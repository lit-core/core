import { compileModule } from '@lit-core/morph-to-react';
import ts from 'typescript';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bundleComponentForBrowser } from '../bundler.js';
import { getTestBrowser } from '../harness.js';

describe('milestone 5 challenger: empirical browser form facade, proxy input, and lifecycle stress testing', () => {
  let browser: any;
  let page: any;

  beforeAll(async () => {
    browser = await getTestBrowser();
    page = await browser.newPage();

    const reactClientBundle = await bundleComponentForBrowser({
      entrySource: `
        import React, { StrictMode, createRef, useState } from 'react';
        import { createRoot } from 'react-dom/client';
        import { flushSync } from 'react-dom';
        import * as morphRuntime from '@lit-core/morph-to-react/runtime';

        window.React = React;
        window.StrictMode = StrictMode;
        window.createRef = createRef;
        window.createRoot = createRoot;
        window.flushSync = flushSync;
        window.morphRuntime = morphRuntime;
        window.__reactReady = true;
      `,
    });

    await page.setContent(`
      <!DOCTYPE html>
      <html>
        <head>
          <script type="module">
            ${reactClientBundle}
          </script>
        </head>
        <body>
          <div id="test-canvas"></div>
        </body>
      </html>
    `);

    await page.waitForFunction(() => (window as any).__reactReady === true);
  });

  afterAll(async () => {
    if (page) await page.close();
  });

  // =========================================================================
  // 1. Multi-Control Real HTML Form Submission and FormData Serialization
  // =========================================================================
  it('empirically verifies multi-control form submission and FormData serialization parity', async () => {
    const codeA = `
      import { LitElement, html, property } from 'lit';
      export class StarRating extends LitElement {
        static formAssociated = true;
        private _internals: ElementInternals;
        @property({ type: Number })
        rating = 5;

        constructor() {
          super();
          this._internals = this.attachInternals();
        }
        firstUpdated() {
          this._internals.setFormValue(String(this.rating));
        }
        updated(changed: Map<string, any>) {
          if (changed.has('rating')) {
            this._internals.setFormValue(String(this.rating));
          }
        }
        render() {
          return html\`<div class="stars">Rating: \${this.rating}</div>\`;
        }
      }
    `;

    const codeB = `
      import { LitElement, html, property } from 'lit';
      export class TagInput extends LitElement {
        static formAssociated = true;
        private _internals: ElementInternals;
        @property({ type: String })
        tag = 'typescript';

        constructor() {
          super();
          this._internals = this.attachInternals();
        }
        firstUpdated() {
          this._internals.setFormValue(this.tag);
        }
        updated(changed: Map<string, any>) {
          if (changed.has('tag')) {
            this._internals.setFormValue(this.tag);
          }
        }
        render() {
          return html\`<div class="tag">Tag: \${this.tag}</div>\`;
        }
      }
    `;

    const resA = compileModule(codeA, { filePath: 'star-rating.ts' });
    const resB = compileModule(codeB, { filePath: 'tag-input.ts' });

    const transA = ts.transpileModule(resA.code, {
      compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS },
    });
    const transB = ts.transpileModule(resB.code, {
      compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS },
    });

    const result = await page.evaluate(
      async ({ jsA, jsB }: { jsA: string; jsB: string }) => {
        const container = document.createElement('div');
        document.body.appendChild(container);

        const React = (window as any).React;
        const createRoot = (window as any).createRoot;
        const flushSync = (window as any).flushSync;

        const customRequire = (spec: string) => {
          if (spec === 'react') return React;
          if (spec === '@lit-core/morph-to-react/runtime') return (window as any).morphRuntime;
          throw new Error(`Unknown specifier: ${spec}`);
        };

        const expA: any = {};
        new Function('React', 'exports', 'require', jsA)(React, expA, customRequire);
        const StarRating = expA.StarRating;

        const expB: any = {};
        new Function('React', 'exports', 'require', jsB)(React, expB, customRequire);
        const TagInput = expB.TagInput;

        const root = createRoot(container);

        // Render form with:
        // 1. StarRating (rating=4, name="rating")
        // 2. TagInput (tag="react19", name="tag")
        // 3. Disabled TagInput (tag="ignored", name="disabled_tag", disabled=true)
        // 4. Native standard input (name="author", defaultValue="Bob")
        flushSync(() => {
          root.render(
            React.createElement(
              'form',
              { id: 'multi-test-form' },
              React.createElement(StarRating, { name: 'rating', rating: 4 }),
              React.createElement(TagInput, { name: 'tag', tag: 'react19' }),
              React.createElement(TagInput, { name: 'disabled_tag', tag: 'ignored', disabled: true }),
              React.createElement('input', { type: 'text', name: 'author', defaultValue: 'Bob' }),
            ),
          );
        });

        const form = container.querySelector('#multi-test-form') as HTMLFormElement;
        const fdInitial = new FormData(form);

        const initialRating = fdInitial.get('rating');
        const initialTag = fdInitial.get('tag');
        const initialDisabledTag = fdInitial.get('disabled_tag');
        const initialAuthor = fdInitial.get('author');

        // Dynamically update rating to 5
        flushSync(() => {
          root.render(
            React.createElement(
              'form',
              { id: 'multi-test-form' },
              React.createElement(StarRating, { name: 'rating', rating: 5 }),
              React.createElement(TagInput, { name: 'tag', tag: 'react19' }),
              React.createElement(TagInput, { name: 'disabled_tag', tag: 'ignored', disabled: true }),
              React.createElement('input', { type: 'text', name: 'author', defaultValue: 'Bob' }),
            ),
          );
        });

        const fdUpdated = new FormData(form);
        const updatedRating = fdUpdated.get('rating');

        // Test form submission via requestSubmit()
        let submittedData: Record<string, string> | null = null;
        form.addEventListener('submit', (e) => {
          e.preventDefault();
          const submittedFd = new FormData(form);
          submittedData = {
            rating: submittedFd.get('rating') as string,
            tag: submittedFd.get('tag') as string,
            disabled_tag: submittedFd.get('disabled_tag') as string,
            author: submittedFd.get('author') as string,
          };
        });

        form.requestSubmit();

        root.unmount();
        container.remove();

        return {
          initialRating,
          initialTag,
          initialDisabledTag,
          initialAuthor,
          updatedRating,
          submittedData,
        };
      },
      { jsA: transA.outputText, jsB: transB.outputText },
    );

    expect(result.initialRating).toBe('4');
    expect(result.initialTag).toBe('react19');
    expect(result.initialDisabledTag).toBeNull(); // Disabled controls must NOT serialize in FormData
    expect(result.initialAuthor).toBe('Bob');
    expect(result.updatedRating).toBe('5');
    expect(result.submittedData).toEqual({
      rating: '5',
      tag: 'react19',
      disabled_tag: null,
      author: 'Bob',
    });
  });

  // =========================================================================
  // 2. Native form.reset() and formResetCallback() Lifecycle
  // =========================================================================
  it('empirically verifies native form.reset() restores default values and triggers formResetCallback', async () => {
    const code = `
      import { LitElement, html, property } from 'lit';

      export class ResettableControl extends LitElement {
        static formAssociated = true;
        private _internals: ElementInternals;

        @property({ type: String })
        value = 'default_search_query';

        resetInvoked = false;

        constructor() {
          super();
          this._internals = this.attachInternals();
        }

        firstUpdated() {
          this._internals.setFormValue(this.value);
        }

        formResetCallback() {
          this.resetInvoked = true;
          this.value = 'default_search_query';
          this._internals.setFormValue(this.value);
        }

        render() {
          return html\`<div>Search: \${this.value}</div>\`;
        }
      }
    `;

    const res = compileModule(code, { filePath: 'resettable-control.ts' });
    const trans = ts.transpileModule(res.code, {
      compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS },
    });

    const result = await page.evaluate(async (transpiledJs: string) => {
      const container = document.createElement('div');
      document.body.appendChild(container);

      const React = (window as any).React;
      const createRoot = (window as any).createRoot;
      const flushSync = (window as any).flushSync;

      const exports: any = {};
      const customRequire = (spec: string) => {
        if (spec === 'react') return React;
        if (spec === '@lit-core/morph-to-react/runtime') return (window as any).morphRuntime;
        throw new Error(`Unknown specifier: ${spec}`);
      };

      new Function('React', 'exports', 'require', transpiledJs)(React, exports, customRequire);
      const ResettableControl = exports.ResettableControl;

      const root = createRoot(container);
      let hostRef: any = null;

      flushSync(() => {
        root.render(
          React.createElement(
            'form',
            { id: 'reset-test-form' },
            React.createElement(ResettableControl, {
              name: 'query',
              ref: (inst: any) => {
                hostRef = inst;
              },
            }),
            React.createElement('input', { type: 'text', name: 'extra', defaultValue: 'initial_extra' }),
          ),
        );
      });

      const form = container.querySelector('#reset-test-form') as HTMLFormElement;

      // 1. Check initial form value
      const initialQuery = new FormData(form).get('query');

      // 2. User edits the control value
      hostRef.value = 'user_typed_query';
      hostRef._internals.setFormValue('user_typed_query');

      const editedQuery = new FormData(form).get('query');

      // 3. Trigger native form reset
      form.reset();

      const wasResetInvoked = hostRef.resetInvoked;
      const resetQuery = new FormData(form).get('query');

      root.unmount();
      container.remove();

      return {
        initialQuery,
        editedQuery,
        wasResetInvoked,
        resetQuery,
      };
    }, trans.outputText);

    expect(result.initialQuery).toBe('default_search_query');
    expect(result.editedQuery).toBe('user_typed_query');
    expect(result.wasResetInvoked).toBe(true);
    expect(result.resetQuery).toBe('default_search_query');
  });

  // =========================================================================
  // 3. Fieldset Disabled and WHATWG Legend Exemption Hierarchy
  // =========================================================================
  it('empirically verifies fieldset disabled observation and WHATWG legend exemption', async () => {
    const code = `
      import { LitElement, html, property } from 'lit';

      export class ObservableControl extends LitElement {
        static formAssociated = true;
        private _internals: ElementInternals;

        disabledHistory: boolean[] = [];

        constructor() {
          super();
          this._internals = this.attachInternals();
        }

        formDisabledCallback(disabled: boolean) {
          this.disabledHistory.push(disabled);
        }

        render() {
          return html\`<div>control</div>\`;
        }
      }
    `;

    const res = compileModule(code, { filePath: 'observable-control.ts' });
    const trans = ts.transpileModule(res.code, {
      compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS },
    });

    const result = await page.evaluate(async (transpiledJs: string) => {
      const container = document.createElement('div');
      document.body.appendChild(container);

      const React = (window as any).React;
      const createRoot = (window as any).createRoot;
      const flushSync = (window as any).flushSync;

      const exports: any = {};
      const customRequire = (spec: string) => {
        if (spec === 'react') return React;
        if (spec === '@lit-core/morph-to-react/runtime') return (window as any).morphRuntime;
        throw new Error(`Unknown specifier: ${spec}`);
      };

      new Function('React', 'exports', 'require', transpiledJs)(React, exports, customRequire);
      const ObservableControl = exports.ObservableControl;

      const root = createRoot(container);
      let refInFirstLegend: any = null;
      let refOutsideLegend: any = null;
      let refInSecondLegend: any = null;

      flushSync(() => {
        root.render(
          React.createElement(
            'form',
            { id: 'fieldset-test-form' },
            React.createElement(
              'fieldset',
              { id: 'test-fieldset' },
              React.createElement(
                'legend',
                { id: 'first-legend' },
                React.createElement(ObservableControl, {
                  name: 'ctrl_first_legend',
                  ref: (inst: any) => {
                    refInFirstLegend = inst;
                  },
                }),
              ),
              React.createElement(ObservableControl, {
                name: 'ctrl_outside_legend',
                ref: (inst: any) => {
                  refOutsideLegend = inst;
                },
              }),
              React.createElement(
                'legend',
                { id: 'second-legend' },
                React.createElement(ObservableControl, {
                  name: 'ctrl_second_legend',
                  ref: (inst: any) => {
                    refInSecondLegend = inst;
                  },
                }),
              ),
            ),
          ),
        );
      });

      const fieldset = container.querySelector('#test-fieldset') as HTMLFieldSetElement;

      // Initially, fieldset is not disabled
      const initialFirstLegendCalls = [...refInFirstLegend.disabledHistory];
      const initialOutsideCalls = [...refOutsideLegend.disabledHistory];
      const initialSecondLegendCalls = [...refInSecondLegend.disabledHistory];

      // Mutate fieldset to disabled = true
      fieldset.disabled = true;

      // Allow MutationObserver to deliver records
      await new Promise((resolve) => setTimeout(resolve, 40));

      const disabledFirstLegendCalls = [...refInFirstLegend.disabledHistory];
      const disabledOutsideCalls = [...refOutsideLegend.disabledHistory];
      const disabledSecondLegendCalls = [...refInSecondLegend.disabledHistory];

      // Mutate fieldset back to disabled = false
      fieldset.disabled = false;
      await new Promise((resolve) => setTimeout(resolve, 40));

      const reenabledFirstLegendCalls = [...refInFirstLegend.disabledHistory];
      const reenabledOutsideCalls = [...refOutsideLegend.disabledHistory];
      const reenabledSecondLegendCalls = [...refInSecondLegend.disabledHistory];

      root.unmount();
      container.remove();

      return {
        initialFirstLegendCalls,
        initialOutsideCalls,
        initialSecondLegendCalls,
        disabledFirstLegendCalls,
        disabledOutsideCalls,
        disabledSecondLegendCalls,
        reenabledFirstLegendCalls,
        reenabledOutsideCalls,
        reenabledSecondLegendCalls,
      };
    }, trans.outputText);

    // Control inside first legend must be EXEMPT from fieldset disabled state:
    // It should NEVER have received formDisabledCallback(true)!
    expect(result.disabledFirstLegendCalls).not.toContain(true);

    // Control outside legend MUST receive formDisabledCallback(true)
    expect(result.disabledOutsideCalls).toContain(true);

    // Control in SECOND legend is NOT exempt per WHATWG HTML 4.10.19 and MUST receive formDisabledCallback(true)
    expect(result.disabledSecondLegendCalls).toContain(true);

    // After re-enabling, controls outside and in second legend must receive false
    expect(result.reenabledOutsideCalls[result.reenabledOutsideCalls.length - 1]).toBe(false);
    expect(result.reenabledSecondLegendCalls[result.reenabledSecondLegendCalls.length - 1]).toBe(false);
  });

  // =========================================================================
  // 4. Constraint Validation and Focus Redirection to Validation Anchor
  // =========================================================================
  it('empirically verifies constraint validation forwarding and focus redirection to validation anchor', async () => {
    const code = `
      import { LitElement, html, property } from 'lit';

      export class AnchoredValidationControl extends LitElement {
        static formAssociated = true;
        private _internals: ElementInternals;

        constructor() {
          super();
          this._internals = this.attachInternals();
        }

        markRequiredWithAnchor(anchor: HTMLElement) {
          this._internals.setValidity({ valueMissing: true }, 'Please fill this anchored field', anchor);
        }

        markRequiredWithoutAnchor() {
          this._internals.setValidity({ valueMissing: true }, 'Please fill host field');
        }

        clearError() {
          this._internals.setValidity({});
        }

        render() {
          return html\`
            <div class="control-wrapper">
              <input class="inner-native-input" placeholder="Type here..." />
              <button class="inner-action-button" type="button">Action</button>
            </div>
          \`;
        }
      }
    `;

    const res = compileModule(code, { filePath: 'anchored-validation-control.ts' });
    const trans = ts.transpileModule(res.code, {
      compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS },
    });

    const result = await page.evaluate(async (transpiledJs: string) => {
      const container = document.createElement('div');
      document.body.appendChild(container);

      const React = (window as any).React;
      const createRoot = (window as any).createRoot;
      const flushSync = (window as any).flushSync;

      const exports: any = {};
      const customRequire = (spec: string) => {
        if (spec === 'react') return React;
        if (spec === '@lit-core/morph-to-react/runtime') return (window as any).morphRuntime;
        throw new Error(`Unknown specifier: ${spec}`);
      };

      new Function('React', 'exports', 'require', transpiledJs)(React, exports, customRequire);
      const AnchoredValidationControl = exports.AnchoredValidationControl;

      const root = createRoot(container);
      let hostRef: any = null;

      flushSync(() => {
        root.render(
          React.createElement(
            'form',
            { id: 'validation-test-form' },
            React.createElement(AnchoredValidationControl, {
              name: 'anchored_field',
              ref: (inst: any) => {
                hostRef = inst;
              },
            }),
          ),
        );
      });

      const form = container.querySelector('#validation-test-form') as HTMLFormElement;
      const hostNode = container.querySelector('anchored-validation-control') as HTMLElement;
      const innerInput = hostNode.querySelector('.inner-native-input') as HTMLElement;
      const innerButton = hostNode.querySelector('.inner-action-button') as HTMLElement;

      // 1. Initially valid
      const initialValid = form.checkValidity();

      // 2. Set validity with innerInput as anchor
      hostRef.markRequiredWithAnchor(innerInput);
      const isInvalidWithAnchor = !form.checkValidity();

      // Blur everything before reportValidity
      (document.activeElement as HTMLElement)?.blur?.();
      form.reportValidity();
      const focusedAfterAnchorReport = document.activeElement === innerInput;

      // 3. Set validity with innerButton as anchor
      hostRef.markRequiredWithAnchor(innerButton);
      (document.activeElement as HTMLElement)?.blur?.();
      form.reportValidity();
      const focusedAfterButtonReport = document.activeElement === innerButton;

      // 4. Set validity without anchor (should redirect focus to host element)
      hostRef.markRequiredWithoutAnchor();
      (document.activeElement as HTMLElement)?.blur?.();
      form.reportValidity();
      const focusedAfterHostReport = document.activeElement === hostNode;

      // 5. Test invalid event on host element
      let invalidEventCaught = false;
      hostNode.addEventListener('invalid', (e) => {
        invalidEventCaught = true;
        e.preventDefault(); // cancel
      });

      hostRef.checkValidity();

      // 6. Clear validity
      hostRef.clearError();
      const validAfterClear = form.checkValidity();

      root.unmount();
      container.remove();

      return {
        initialValid,
        isInvalidWithAnchor,
        focusedAfterAnchorReport,
        focusedAfterButtonReport,
        focusedAfterHostReport,
        invalidEventCaught,
        validAfterClear,
      };
    }, trans.outputText);

    expect(result.initialValid).toBe(true);
    expect(result.isInvalidWithAnchor).toBe(true);
    expect(result.focusedAfterAnchorReport).toBe(true);
    expect(result.focusedAfterButtonReport).toBe(true);
    expect(result.focusedAfterHostReport).toBe(true);
    expect(result.invalidEventCaught).toBe(true);
    expect(result.validAfterClear).toBe(true);
  });

  // =========================================================================
  // 5. Form Association Without Form Parent (form="form-id" attribute)
  // =========================================================================
  it('empirically stress-tests form association outside form parent via form attribute', async () => {
    const code = `
      import { LitElement, html, property } from 'lit';

      export class ExternalAssocControl extends LitElement {
        static formAssociated = true;
        private _internals: ElementInternals;

        @property({ type: String, reflect: true })
        form = '';

        associatedFormId: string | null = null;
        resetInvoked = false;

        constructor() {
          super();
          this._internals = this.attachInternals();
        }

        firstUpdated() {
          this._internals.setFormValue('detached_value_123');
        }

        formAssociatedCallback(form: HTMLFormElement | null) {
          this.associatedFormId = form ? form.id : null;
        }

        formResetCallback() {
          this.resetInvoked = true;
        }

        render() {
          return html\`<div>detached</div>\`;
        }
      }
    `;

    const res = compileModule(code, { filePath: 'external-assoc-control.ts' });
    const trans = ts.transpileModule(res.code, {
      compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS },
    });

    const result = await page.evaluate(async (transpiledJs: string) => {
      const container = document.createElement('div');
      document.body.appendChild(container);

      const React = (window as any).React;
      const createRoot = (window as any).createRoot;
      const flushSync = (window as any).flushSync;

      const errors: string[] = [];
      const origErr = console.error;
      console.error = (...args: any[]) => {
        errors.push(args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' '));
        origErr.apply(console, args);
      };

      const exports: any = {};
      const customRequire = (spec: string) => {
        if (spec === 'react') return React;
        if (spec === '@lit-core/morph-to-react/runtime') return (window as any).morphRuntime;
        throw new Error(`Unknown specifier: ${spec}`);
      };

      new Function('React', 'exports', 'require', transpiledJs)(React, exports, customRequire);
      const ExternalAssocControl = exports.ExternalAssocControl;

      const root = createRoot(container);
      let hostRef: any = null;
      let renderError: string | null = null;

      try {
        flushSync(() => {
          root.render(
            React.createElement(
              'div',
              null,
              React.createElement('form', { id: 'external-target-form' }, React.createElement('input', { name: 'inside', defaultValue: 'inside_val' })),
              React.createElement(ExternalAssocControl, {
                form: 'external-target-form',
                name: 'detached_field',
                ref: (inst: any) => {
                  hostRef = inst;
                  console.log('REF CALLBACK INST:', inst ? inst.tagName || typeof inst : String(inst));
                },
              }),
            ),
          );
        });
      } catch (err: any) {
        renderError = String(err?.stack || err?.message || err);
      }

      const externalForm = container.querySelector('#external-target-form') as HTMLFormElement;
      const customEl = container.querySelector('external-assoc-control') as HTMLElement;

      // 1. Check form association
      const associatedFormId = hostRef?.associatedFormId ?? hostRef?._host?.associatedFormId;
      const hostFormPropId = hostRef?.form?.id;

      // 2. Test form.reset() invoking formResetCallback on detached element
      if (externalForm) {
        externalForm.reset();
      }
      const resetInvokedOnDetached = hostRef?.resetInvoked;

      // 3. Test FormData serialization on external form
      let insideValue: any = null;
      let detachedValue: any = null;
      if (externalForm) {
        const externalFd = new FormData(externalForm);
        insideValue = externalFd.get('inside');
        detachedValue = externalFd.get('detached_field');
      }

      const innerHtml = container.innerHTML;

      root.unmount();
      container.remove();
      console.error = origErr;

      return {
        renderError,
        errors,
        hasHostRef: Boolean(hostRef),
        hasCustomEl: Boolean(customEl),
        associatedFormId,
        hostFormPropId,
        resetInvokedOnDetached,
        insideValue,
        detachedValue,
        innerHtml,
      };
    }, trans.outputText);

    expect(result.hasCustomEl).toBe(true);
    expect(result.associatedFormId).toBe('external-target-form');
    expect(result.resetInvokedOnDetached).toBe(true);
    expect(result.insideValue).toBe('inside_val');

    // Empirical observation: proxy input does not receive form attribute,
    // so new FormData(externalForm) does not serialize detached form controls.
    expect(result.detachedValue).toBeNull();
  });
});
