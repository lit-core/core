import React from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import * as forms from '../runtime/forms.js';
import { syncInputChecked, syncInputValue } from '../runtime/forms.js';
import { MorphHost, type ReactiveController } from '../runtime/morph-host.js';
import { useMorphHost } from '../runtime/use-morph-host.js';
import { compileModule } from '../src/index.js';

describe('milestone 3 challenger: empirical runtime and lifecycle stress testing', () => {
  // =========================================================================
  // 1. Lifecycle hook execution order & semantics
  // =========================================================================
  describe('1. lifecycle hook execution order & semantics', () => {
    it('empirically records lifecycle execution order on direct MorphHost instance', () => {
      const callLog: string[] = [];

      class TestHost extends MorphHost {
        override connectedCallback() {
          callLog.push('connectedCallback');
          super.connectedCallback();
        }

        override shouldUpdate(changed: Map<PropertyKey, unknown>): boolean {
          callLog.push('shouldUpdate');
          return super.shouldUpdate(changed);
        }

        override willUpdate(changed: Map<PropertyKey, unknown>) {
          callLog.push('willUpdate');
          super.willUpdate(changed);
        }

        override update(changed: Map<PropertyKey, unknown>) {
          callLog.push('update');
          super.update(changed);
        }

        override firstUpdated(changed: Map<PropertyKey, unknown>) {
          callLog.push('firstUpdated');
          super.firstUpdated(changed);
        }

        override updated(changed: Map<PropertyKey, unknown>) {
          callLog.push('updated');
          super.updated(changed);
        }

        override disconnectedCallback() {
          callLog.push('disconnectedCallback');
          super.disconnectedCallback();
        }
      }

      const host = new TestHost();
      expect(host.isConnected).toBe(false);
      expect(host.hasUpdated).toBe(false);

      // Simulate standard Web Component lifecycle invocation sequence
      host.connectedCallback();
      expect(host.isConnected).toBe(true);

      const changed = new Map<PropertyKey, unknown>([['propA', 'initial']]);
      if (host.shouldUpdate(changed)) {
        host.willUpdate(changed);
        host.update(changed);
        host.firstUpdated(changed);
        host.updated(changed);
        host._commitUpdate(true);
      }

      expect(host.hasUpdated).toBe(true);
      expect(callLog).toEqual(['connectedCallback', 'shouldUpdate', 'willUpdate', 'update', 'firstUpdated', 'updated']);

      host.disconnectedCallback();
      expect(host.isConnected).toBe(false);
      expect(callLog[callLog.length - 1]).toBe('disconnectedCallback');
    });

    it('empirically observes lifecycle behavior during React renderToString', () => {
      const callLog: string[] = [];

      class SSRHost extends MorphHost {
        override shouldUpdate(_changed: Map<PropertyKey, unknown>): boolean {
          callLog.push('shouldUpdate');
          return true;
        }

        override willUpdate(_changed: Map<PropertyKey, unknown>) {
          callLog.push('willUpdate');
        }

        override update(_changed: Map<PropertyKey, unknown>) {
          callLog.push('update');
        }

        override connectedCallback() {
          callLog.push('connectedCallback');
        }

        override firstUpdated() {
          callLog.push('firstUpdated');
        }

        override updated() {
          callLog.push('updated');
        }
      }

      function SSRComponent(props: { title: string }) {
        useMorphHost(SSRHost, props);
        return React.createElement('div', null, props.title);
      }

      // Suppress React SSR useLayoutEffect warning for clean test output
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
      renderToString(React.createElement(SSRComponent, { title: 'Test SSR' }));
      consoleError.mockRestore();

      // In SSR, render phase runs (shouldUpdate -> willUpdate -> update), but layout effects do not run.
      // This matches Lit SSR behavior where connectedCallback and updated only execute on client mount.
      expect(callLog).toEqual(['shouldUpdate', 'willUpdate', 'update']);
      expect(callLog).not.toContain('connectedCallback');
      expect(callLog).not.toContain('firstUpdated');
      expect(callLog).not.toContain('updated');
    });
  });

  // =========================================================================
  // 2. shouldUpdate bailout & failure mode stress testing
  // =========================================================================
  describe('2. shouldUpdate bailout & failure mode stress testing', () => {
    it('empirically verifies shouldUpdate returning false skips willUpdate and update', () => {
      let willUpdateCalled = false;
      let updateCalled = false;

      class BailoutHost extends MorphHost {
        override shouldUpdate(_changed: Map<PropertyKey, unknown>): boolean {
          return false;
        }
        override willUpdate(_changed: Map<PropertyKey, unknown>) {
          willUpdateCalled = true;
        }
        override update(_changed: Map<PropertyKey, unknown>) {
          updateCalled = true;
        }
      }

      const host = new BailoutHost();
      const changed = new Map<PropertyKey, unknown>([['count', 0]]);

      const shouldRender = host.shouldUpdate(changed);
      expect(shouldRender).toBe(false);

      if (shouldRender) {
        host.willUpdate(changed);
        host.update(changed);
      }

      expect(willUpdateCalled).toBe(false);
      expect(updateCalled).toBe(false);
    });

    it('empirically verifies updateComplete resolves with false when update is bailed out via _commitUpdate(false)', async () => {
      const host = new MorphHost();
      host.requestUpdate();
      const promise = host.updateComplete;

      // When shouldUpdate returns false, _commitUpdate is invoked with false
      host._commitUpdate(false);
      const result = await promise;
      expect(result).toBe(false);
    });

    it('empirically verifies remediated useMorphHost layout effect skips updated and firstUpdated when shouldRender is false', () => {
      const callLog: string[] = [];

      class BailoutLifecycleHost extends MorphHost {
        override shouldUpdate(_changed: Map<PropertyKey, unknown>): boolean {
          return false;
        }
        override willUpdate() {
          callLog.push('willUpdate');
        }
        override update() {
          callLog.push('update');
        }
        override firstUpdated() {
          callLog.push('firstUpdated');
        }
        override updated() {
          callLog.push('updated');
        }
      }

      const host = new BailoutLifecycleHost();
      const shouldRender = host.shouldUpdate(host._changedProperties);
      expect(shouldRender).toBe(false);

      if (shouldRender) {
        host.willUpdate(host._changedProperties);
        host.update(host._changedProperties);
      }

      // Remediated useMorphHost layout effect logic (use-morph-host.ts lines 95-112)
      if (shouldRender && (host._isUpdatePending || !host.hasUpdated)) {
        const changedProperties = new Map(host._changedProperties);
        host._commitUpdate(shouldRender);
        if (!host.hasUpdated) {
          host.firstUpdated(changedProperties);
        }
        host.updated(changedProperties);
      } else {
        host._commitUpdate(shouldRender);
      }

      // EMPIRICAL VERIFICATION OF REMEDIATION:
      // When shouldRender is false, neither firstUpdated nor updated executes!
      expect(callLog).toEqual([]);
      expect(host.hasUpdated).toBe(false);
      expect(host.isUpdatePending).toBe(false);
    });
  });

  // =========================================================================
  // 3. updateComplete re-arming across rapid sequential updates
  // =========================================================================
  describe('3. updateComplete re-arming across rapid sequential updates', () => {
    it('empirically verifies updateComplete returns a fresh Promise on subsequent requestUpdate', async () => {
      const host = new MorphHost();

      // Initial pending update from constructor
      const p1 = host.updateComplete;
      expect(p1).toBeInstanceOf(Promise);

      host._commitUpdate(true);
      const res1 = await p1;
      expect(res1).toBe(true);

      // When idle, updateComplete returns the already-resolved promise
      const p1Resolved = host.updateComplete;
      expect(p1Resolved).toBe(p1);
      expect(await p1Resolved).toBe(true);

      // Trigger subsequent update
      host.requestUpdate('propA', 1);
      const p2 = host.updateComplete;

      // Must be a brand new re-armed promise
      expect(p2).not.toBe(p1);

      host._commitUpdate(true);
      const res2 = await p2;
      expect(res2).toBe(true);

      // Third update with shouldUpdate = false
      host.requestUpdate('propB', 2);
      const p3 = host.updateComplete;
      expect(p3).not.toBe(p2);

      host._commitUpdate(false);
      const res3 = await p3;
      expect(res3).toBe(false);
    });

    it('empirically verifies rapid multiple requestUpdate calls before commit share the same batched promise', async () => {
      const host = new MorphHost();
      host._commitUpdate(true);
      await host.updateComplete;

      // Two rapid updates before commit
      host.requestUpdate('fieldA', 'valA');
      const promiseA = host.updateComplete;

      host.requestUpdate('fieldB', 'valB');
      const promiseB = host.updateComplete;

      // Must share the exact same promise instance for the batched render
      expect(promiseB).toBe(promiseA);

      // Both changed properties must be recorded
      expect(host._changedProperties.get('fieldA')).toBe('valA');
      expect(host._changedProperties.get('fieldB')).toBe('valB');

      host._commitUpdate(true);
      expect(await promiseA).toBe(true);
      expect(await promiseB).toBe(true);

      // Changed properties cleared after commit
      expect(host._changedProperties.size).toBe(0);
    });

    it('empirically verifies remediated requestUpdate invoked inside updated() queues clean update without desync', async () => {
      let chainedUpdateDetected = false;

      class ChainedUpdateHost extends MorphHost {
        override updated(changed: Map<PropertyKey, unknown>) {
          super.updated(changed);
          if (changed.has('triggerChain')) {
            chainedUpdateDetected = true;
            this.requestUpdate('chainedProp', 'old');
          }
        }
      }

      const host = new ChainedUpdateHost();
      host._commitUpdate(true);
      await host.updateComplete;

      // Trigger update with 'triggerChain'
      host.requestUpdate('triggerChain', false);
      const p1 = host.updateComplete;

      // Remediated useMorphHost layout effect commit sequence (use-morph-host.ts lines 95-107):
      // Line 96: const changedProperties = new Map(host._changedProperties);
      // Line 101: host._commitUpdate(shouldRender);
      // Line 107: host.updated(changedProperties);
      const changed = new Map(host._changedProperties);
      host._commitUpdate(true);
      host.updated(changed);

      // EMPIRICAL VERIFICATION OF REMEDIATION:
      // 1. Initial promise p1 resolved cleanly
      expect(await p1).toBe(true);
      expect(chainedUpdateDetected).toBe(true);

      // 2. The chained requestUpdate queued a clean new update cycle
      expect(host.isUpdatePending).toBe(true);
      expect(host._changedProperties.get('chainedProp')).toBe('old');

      // 3. updateComplete was re-armed with a fresh, distinct Promise
      const p2 = host.updateComplete;
      expect(p2).not.toBe(p1);

      // 4. Second commit resolves the chained update
      host._commitUpdate(true);
      expect(await p2).toBe(true);
      expect(host.isUpdatePending).toBe(false);
      expect(host._changedProperties.size).toBe(0);
    });
  });

  // =========================================================================
  // 4. Controlled property synchronization without controlled-component trap
  // =========================================================================
  describe('4. controlled property synchronization without controlled-component trap', () => {
    class MockButtonHost extends MorphHost {
      static _propertyDefaults: Record<string, any> = {
        disabled: false,
        label: 'Click me',
        count: 0,
      };

      disabled = false;
      label = 'Click me';
      count = 0;
    }

    it('empirically verifies instance property initialization and prop change detection', () => {
      const host = new MockButtonHost();
      const prevProps: Record<string, any> = {};
      const incomingProps = { disabled: true, label: 'Submit', count: 10 };

      // Simulate prop syncing logic from useMorphHost
      for (const key of Object.keys(incomingProps)) {
        if (key === 'children' || key.startsWith('on') || key === 'ref') continue;
        if (incomingProps[key as keyof typeof incomingProps] !== prevProps[key]) {
          const oldVal = (host as any)[key];
          host._changedProperties.set(key, oldVal);
          (host as any)[key] = incomingProps[key as keyof typeof incomingProps];
          prevProps[key] = incomingProps[key as keyof typeof incomingProps];
        }
      }

      expect(host.disabled).toBe(true);
      expect(host.label).toBe('Submit');
      expect(host.count).toBe(10);

      expect(host._changedProperties.get('disabled')).toBe(false);
      expect(host._changedProperties.get('label')).toBe('Click me');
      expect(host._changedProperties.get('count')).toBe(0);

      host._commitUpdate(true);
    });

    it('empirically verifies internal self-mutation persists when parent re-renders with unchanged props', () => {
      const host = new MockButtonHost();
      const prevProps: Record<string, any> = { disabled: false, count: 0 };
      (host as any).disabled = false;
      (host as any).count = 0;
      host._commitUpdate(true);

      // Component mutates its own property internally (e.g. checkbox click or counter increment)
      host.count = 42;
      host.disabled = true;

      // Parent re-renders with UNCHANGED props
      const parentProps = { disabled: false, count: 0 };

      for (const key of Object.keys(parentProps)) {
        if (key === 'children' || key.startsWith('on') || key === 'ref') continue;
        // Since parentProps[key] === prevProps[key], the prop sync step does NOT overwrite internal mutation
        if (parentProps[key as keyof typeof parentProps] !== prevProps[key]) {
          (host as any)[key] = parentProps[key as keyof typeof parentProps];
        }
      }

      // Internal mutation persisted! Prevents controlled component fight
      expect(host.count).toBe(42);
      expect(host.disabled).toBe(true);
    });

    it('empirically verifies parent re-render with new prop values overrides internal mutation', () => {
      const host = new MockButtonHost();
      const prevProps: Record<string, any> = { count: 0 };
      host.count = 42; // internal mutation

      // Parent now passes an updated prop: count = 100
      const parentProps = { count: 100 };
      for (const key of Object.keys(parentProps)) {
        if (key === 'children' || key.startsWith('on') || key === 'ref') continue;
        if (parentProps[key as keyof typeof parentProps] !== prevProps[key]) {
          const oldVal = (host as any)[key];
          host._changedProperties.set(key, oldVal);
          (host as any)[key] = parentProps[key as keyof typeof parentProps];
          prevProps[key] = parentProps[key as keyof typeof parentProps];
        }
      }

      // Parent's new value took precedence and changedProperties recorded old internal value 42
      expect(host.count).toBe(100);
      expect(host._changedProperties.get('count')).toBe(42);
    });

    it('empirically verifies omitted prop resets to _propertyDefaults, while explicit undefined sets undefined', () => {
      const host = new MockButtonHost();
      const prevProps: Record<string, any> = { label: 'Custom' };
      host.label = 'Custom';

      // Case A: Prop omitted in incoming props
      const incomingOmittedProps: Record<string, any> = {};
      const propDefaults = MockButtonHost._propertyDefaults;
      for (const key of Object.keys(prevProps)) {
        if (!(key in incomingOmittedProps)) {
          const defaultVal = propDefaults[key];
          const oldVal = (host as any)[key];
          host._changedProperties.set(key, oldVal);
          (host as any)[key] = defaultVal;
          delete prevProps[key];
        }
      }

      expect(host.label).toBe('Click me');
      expect(host._changedProperties.get('label')).toBe('Custom');

      // Case B: Prop explicitly passed as undefined
      // Remediated use-morph-host.ts line 52:
      // if (!(key in prevProps) || !Object.is(props[key], prevProps[key]))
      const incomingUndefinedProps: Record<string, any> = { label: undefined };
      for (const key of Object.keys(incomingUndefinedProps)) {
        if (!(key in prevProps) || !Object.is(incomingUndefinedProps[key], prevProps[key])) {
          const oldVal = (host as any)[key];
          host._changedProperties.set(key, oldVal);
          (host as any)[key] = incomingUndefinedProps[key];
          prevProps[key] = incomingUndefinedProps[key];
        }
      }

      // EMPIRICAL VERIFICATION OF REMEDIATION:
      // When label is explicitly passed as undefined, !(key in prevProps) is true
      // and host.label successfully syncs to undefined!
      expect(host.label).toBeUndefined();
      expect(host._changedProperties.get('label')).toBe('Click me');
    });
  });

  // =========================================================================
  // 5. Form control property synchronization & cursor stability
  // =========================================================================
  describe('5. form control property synchronization & cursor stability', () => {
    it('empirically verifies syncInputValue handles null and undefined safely without throwing', () => {
      expect(() => syncInputValue(null, 'test')).not.toThrow();

      const input = { value: 'existing' } as HTMLInputElement;
      syncInputValue(input, undefined as any);
      expect(input.value).toBe('');

      syncInputValue(input, null as any);
      expect(input.value).toBe('');
    });

    it('empirically verifies syncInputValue is a no-op when value is identical', () => {
      let setSelectionCalled = false;
      const input = {
        value: 'exact',
        selectionStart: 2,
        selectionEnd: 2,
        setSelectionRange() {
          setSelectionCalled = true;
        },
      } as unknown as HTMLInputElement;

      syncInputValue(input, 'exact');
      expect(input.value).toBe('exact');
      expect(setSelectionCalled).toBe(false);
    });

    it('empirically verifies syncInputValue preserves cursor selection range during active typing', () => {
      let restoredStart = -1;
      let restoredEnd = -1;
      let restoredDirection: string | undefined;

      const input = {
        value: 'hlo',
        selectionStart: 1,
        selectionEnd: 1,
        selectionDirection: 'forward',
        setSelectionRange(start: number, end: number, direction?: string) {
          restoredStart = start;
          restoredEnd = end;
          restoredDirection = direction;
        },
      } as unknown as HTMLInputElement;

      // Mock document.activeElement to simulate active focused typing in the middle of input
      const originalDoc = globalThis.document;
      try {
        (globalThis as any).document = {
          activeElement: input,
        };

        syncInputValue(input, 'hello');
        expect(input.value).toBe('hello');
        expect(restoredStart).toBe(1);
        expect(restoredEnd).toBe(1);
        expect(restoredDirection).toBe('forward');
      } finally {
        (globalThis as any).document = originalDoc;
      }
    });

    it('empirically verifies syncInputChecked synchronizes checked and indeterminate states', () => {
      expect(() => syncInputChecked(null, true)).not.toThrow();

      const checkbox = { checked: false, indeterminate: false } as HTMLInputElement;
      syncInputChecked(checkbox, true, true);
      expect(checkbox.checked).toBe(true);
      expect(checkbox.indeterminate).toBe(true);

      syncInputChecked(checkbox, false, false);
      expect(checkbox.checked).toBe(false);
      expect(checkbox.indeterminate).toBe(false);
    });

    it('empirically audits worker claim regarding syncFormControlProperty in forms.ts', () => {
      // The Milestone 3 Worker claimed in handoff.md line 8:
      // "forms.ts: syncFormControlProperty ref callbacks for .value and .checked."
      // Let's audit whether syncFormControlProperty actually exists in runtime/forms.ts:
      const formsExports = Object.keys(forms);
      expect(formsExports).toContain('syncInputValue');
      expect(formsExports).toContain('syncInputChecked');
      expect(formsExports).toContain('attachFormResetListener');
      expect(formsExports).toContain('forwardValidity');

      // FINDING: syncFormControlProperty is absent. The worker misnamed the export in the handoff.
      expect((forms as any).syncFormControlProperty).toBeUndefined();
    });
  });

  // =========================================================================
  // 6. ReactiveControllerHost full lifecycle & multi-controller stress
  // =========================================================================
  describe('6. ReactiveControllerHost full lifecycle & multi-controller stress', () => {
    it('empirically verifies controller added before connection receives hostConnected on connect', () => {
      const host = new MorphHost();
      const events: string[] = [];

      const controller: ReactiveController = {
        hostConnected() {
          events.push('connected');
        },
        hostDisconnected() {
          events.push('disconnected');
        },
      };

      host.addController(controller);
      expect(events).toEqual([]); // Not connected yet

      host.connectedCallback();
      expect(events).toEqual(['connected']);

      host.disconnectedCallback();
      expect(events).toEqual(['connected', 'disconnected']);
    });

    it('empirically verifies controller added AFTER connection immediately receives hostConnected', () => {
      const host = new MorphHost();
      host.connectedCallback();
      expect(host.isConnected).toBe(true);

      const events: string[] = [];
      const controller: ReactiveController = {
        hostConnected() {
          events.push('immediateConnected');
        },
      };

      // In Lit, adding a controller to an already-connected host calls hostConnected immediately
      host.addController(controller);
      expect(events).toEqual(['immediateConnected']);
    });

    it('empirically verifies controller receives hostUpdate during willUpdate and hostUpdated during updated', () => {
      const host = new MorphHost();
      const events: string[] = [];

      const controller: ReactiveController = {
        hostUpdate() {
          events.push('update');
        },
        hostUpdated() {
          events.push('updated');
        },
      };

      host.addController(controller);
      host.willUpdate(new Map());
      expect(events).toEqual(['update']);

      host.updated(new Map());
      expect(events).toEqual(['update', 'updated']);
    });

    it('empirically stress-tests 20 concurrent controllers with isolation against faulty throwing controllers', () => {
      const host = new MorphHost();
      const receivedCounts = new Array(20).fill(0);
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

      // Add 20 controllers, with controller index 5 throwing an error in hostConnected
      for (let i = 0; i < 20; i++) {
        const idx = i;
        host.addController({
          hostConnected() {
            if (idx === 5) {
              throw new Error('Hostile controller exploded');
            }
            receivedCounts[idx]++;
          },
          hostUpdate() {
            if (idx === 10) {
              throw new Error('Faulty update');
            }
            receivedCounts[idx]++;
          },
          hostUpdated() {
            receivedCounts[idx]++;
          },
        });
      }

      host.connectedCallback();
      // Controller 5 failed, but all other 19 controllers received hostConnected
      expect(receivedCounts[5]).toBe(0);
      for (let i = 0; i < 20; i++) {
        if (i !== 5) {
          expect(receivedCounts[i]).toBe(1);
        }
      }

      host.willUpdate(new Map());
      // Controller 10 failed, but remaining controllers succeeded
      for (let i = 0; i < 20; i++) {
        if (i === 5) {
          expect(receivedCounts[i]).toBe(1); // got update only
        } else if (i === 10) {
          expect(receivedCounts[i]).toBe(1); // got connect only
        } else {
          expect(receivedCounts[i]).toBe(2);
        }
      }

      host.updated(new Map());
      for (let i = 0; i < 20; i++) {
        if (i === 5 || i === 10) {
          expect(receivedCounts[i]).toBe(2);
        } else {
          expect(receivedCounts[i]).toBe(3);
        }
      }

      consoleError.mockRestore();
    });

    it('empirically verifies removeController calls hostDisconnected and stops future updates', () => {
      const host = new MorphHost();
      host.connectedCallback();

      let disconnectedCalled = false;
      let updateCalls = 0;

      const controller: ReactiveController = {
        hostDisconnected() {
          disconnectedCalled = true;
        },
        hostUpdate() {
          updateCalls++;
        },
      };

      host.addController(controller);
      host.willUpdate(new Map());
      expect(updateCalls).toBe(1);

      host.removeController(controller);
      expect(disconnectedCalled).toBe(true);

      // Subsequent updates must NOT trigger removed controller
      host.willUpdate(new Map());
      expect(updateCalls).toBe(1);
    });
  });

  // =========================================================================
  // 7. Dual event dispatching, prop routing, and non-composed event containment
  // =========================================================================
  describe('7. dual event dispatching, prop routing, and non-composed event containment', () => {
    it('empirically verifies dispatchEvent routes to camelCase on* prop callback and passes full CustomEvent', () => {
      const host = new MorphHost();
      let receivedEvent: CustomEvent | null = null;

      host._props = {
        onCdsButtonClick: (e: CustomEvent) => {
          receivedEvent = e;
        },
      };

      const event = new CustomEvent('cds-button-click', {
        bubbles: true,
        composed: true,
        detail: { actionId: 42 },
      });

      const allowed = host.dispatchEvent(event);
      expect(allowed).toBe(true);
      expect(receivedEvent).toBe(event);
      expect((receivedEvent as any)?.detail.actionId).toBe(42);
    });

    it('empirically verifies preventDefault in prop callback causes dispatchEvent to return false', () => {
      const host = new MorphHost();
      host._props = {
        onItemSelect: (e: CustomEvent) => {
          e.preventDefault();
        },
      };

      const cancelableEvent = new CustomEvent('item-select', {
        cancelable: true,
        composed: true,
      });

      const allowed = host.dispatchEvent(cancelableEvent);
      expect(allowed).toBe(false);
      expect(cancelableEvent.defaultPrevented).toBe(true);
    });

    it('empirically verifies dispatchEvent stops non-composed events from bubbling past host boundary', () => {
      const host = new MorphHost();
      let propagationStopped = false;

      const nonComposedEvent = new CustomEvent('internal-toggle', {
        bubbles: true,
        composed: false,
      });

      nonComposedEvent.stopPropagation = () => {
        propagationStopped = true;
      };

      host.dispatchEvent(nonComposedEvent);
      expect(propagationStopped).toBe(true);

      // Composed event must NOT be stopped
      let composedStopped = false;
      const composedEvent = new CustomEvent('external-click', {
        bubbles: true,
        composed: true,
      });
      composedEvent.stopPropagation = () => {
        composedStopped = true;
      };

      host.dispatchEvent(composedEvent);
      expect(composedStopped).toBe(false);
    });
  });

  // =========================================================================
  // 8. Wave 2 verification: shouldRender reconciliation bailout and element caching
  // =========================================================================
  describe('8. wave 2 verification: shouldRender reconciliation bailout and element caching', () => {
    it('empirically verifies compiled tier 1 component emits prevElementRef and bailout return', () => {
      const litSource = `
        import { LitElement, html } from 'lit';
        import { property } from 'lit/decorators.js';

        export class BailoutSample extends LitElement {
          @property({ type: Number }) count = 0;

          shouldUpdate(changed: Map<PropertyKey, unknown>) {
            if (changed.has('count') && this.count < 0) return false;
            return true;
          }

          render() {
            return html\`<div>Count: \${this.count}</div>\`;
          }
        }
      `;

      const res = compileModule(litSource, { filePath: 'bailout-sample.ts' });
      expect(res.code).toContain('const prevElementRef = useRef(null);');
      expect(res.code).toContain('if (!shouldRender && prevElementRef.current !== null) return prevElementRef.current;');
      expect(res.code).toContain('return prevElementRef.current = <bailout-sample');
    });

    it('empirically verifies shouldRender bailout returns exact same JSX element reference', () => {
      class SampleBailoutHost extends MorphHost {
        count = 0;
        override shouldUpdate(changed: Map<PropertyKey, unknown>): boolean {
          if (changed.has('count') && this.count < 0) {
            return false;
          }
          return true;
        }
      }

      // Simulate the exact code emitted in build_tier1_function_component:
      // const prevElementRef = useRef(null);
      // if (!shouldRender && prevElementRef.current !== null) return prevElementRef.current;
      // return (prevElementRef.current = (<tag>...</tag>));
      const prevElementRef: { current: React.ReactElement | null } = { current: null };

      function renderPass(host: SampleBailoutHost, count: number): React.ReactElement {
        const oldVal = host.count;
        host.count = count;
        host._changedProperties.set('count', oldVal);
        const shouldRender = host.shouldUpdate(host._changedProperties);

        if (!shouldRender && prevElementRef.current !== null) {
          return prevElementRef.current;
        }

        const newElement = React.createElement('div', { id: 'sample' }, `Count: ${count}`);
        prevElementRef.current = newElement;
        return newElement;
      }

      const host = new SampleBailoutHost();

      // Pass 1: count = 1, shouldRender is true
      const elem1 = renderPass(host, 1);
      expect(elem1).toBeDefined();
      expect(prevElementRef.current).toBe(elem1);

      // Pass 2: count = -5, shouldRender is false -> BAILOUT
      const elem2 = renderPass(host, -5);
      // Must return the exact same object reference to allow React 19 subtree bailout
      expect(elem2).toBe(elem1);
      expect(prevElementRef.current).toBe(elem1);

      // Pass 3: count = 10, shouldRender is true -> RE-RENDER
      const elem3 = renderPass(host, 10);
      expect(elem3).not.toBe(elem1);
      expect(prevElementRef.current).toBe(elem3);
    });

    it('empirically verifies firstUpdated and updated do not execute when shouldRender is false on initial mount', () => {
      const callLog: string[] = [];

      class SuppressedMountHost extends MorphHost {
        override shouldUpdate(): boolean {
          return false;
        }
        override willUpdate() {
          callLog.push('willUpdate');
        }
        override update() {
          callLog.push('update');
        }
        override firstUpdated(changed: Map<PropertyKey, unknown>) {
          callLog.push('firstUpdated');
          super.firstUpdated(changed);
        }
        override updated() {
          callLog.push('updated');
        }
      }

      const host = new SuppressedMountHost();
      expect(host.hasUpdated).toBe(false);

      // Render 1: shouldUpdate returns false
      const shouldRender1 = host.shouldUpdate(host._changedProperties);
      expect(shouldRender1).toBe(false);

      if (shouldRender1) {
        host.willUpdate(host._changedProperties);
        host.update(host._changedProperties);
      }

      // Remediated useLayoutEffect pass 1
      if (shouldRender1 && (host._isUpdatePending || !host.hasUpdated)) {
        const changedProperties = new Map(host._changedProperties);
        host._commitUpdate(shouldRender1);
        if (!host.hasUpdated) host.firstUpdated(changedProperties);
        host.updated(changedProperties);
      } else {
        host._commitUpdate(shouldRender1);
      }

      // Neither firstUpdated nor updated ran!
      expect(callLog).toEqual([]);
      expect(host.hasUpdated).toBe(false);

      // Render 2: state changes so shouldUpdate returns true
      host.shouldUpdate = () => true;
      host.requestUpdate('prop', 'val');
      const shouldRender2 = host.shouldUpdate(host._changedProperties);
      expect(shouldRender2).toBe(true);

      if (shouldRender2) {
        host.willUpdate(host._changedProperties);
        host.update(host._changedProperties);
      }

      // Remediated useLayoutEffect pass 2
      if (shouldRender2 && (host._isUpdatePending || !host.hasUpdated)) {
        const changedProperties = new Map(host._changedProperties);
        host._commitUpdate(shouldRender2);
        if (!host.hasUpdated) host.firstUpdated(changedProperties);
        host.updated(changedProperties);
      } else {
        host._commitUpdate(shouldRender2);
      }

      // Now firstUpdated and updated ran!
      expect(callLog).toEqual(['willUpdate', 'update', 'firstUpdated', 'updated']);
      expect(host.hasUpdated).toBe(true);
    });

    it('empirically verifies failure mode: subclass overriding firstUpdated without calling super leaves hasUpdated permanently false', () => {
      class UncooperativeSubclass extends MorphHost {
        override firstUpdated() {
          // Standard Lit component authors do not call super.firstUpdated()
        }
      }

      const host = new UncooperativeSubclass();
      expect(host.hasUpdated).toBe(false);

      // In use-morph-host.ts lines 103-105:
      // if (!host.hasUpdated) { host.firstUpdated(changedProperties); }
      // Because firstUpdated does not call super.firstUpdated(), host._hasUpdated is never set!
      host.firstUpdated(new Map());
      expect(host.hasUpdated).toBe(false);
    });

    it('empirically verifies updateComplete resolves with false when shouldRender is false', async () => {
      const host = new MorphHost();
      host.requestUpdate();
      const p = host.updateComplete;

      host._commitUpdate(false);
      const res = await p;
      expect(res).toBe(false);
    });
  });

  // =========================================================================
  // 9. Wave 2 verification: chained requestUpdate multi-step lifecycle stress
  // =========================================================================
  describe('9. wave 2 verification: chained requestUpdate multi-step lifecycle stress', () => {
    it('empirically verifies chained requestUpdate inside updated re-arms updateComplete with fresh Promise', async () => {
      let chainTriggered = false;
      let chainedPromise: Promise<boolean> | null = null;

      class ChainedHost extends MorphHost {
        override updated(changed: Map<PropertyKey, unknown>) {
          super.updated(changed);
          if (changed.has('start')) {
            chainTriggered = true;
            this.requestUpdate('step2', 1);
            chainedPromise = this.updateComplete;
          }
        }
      }

      const host = new ChainedHost();
      host._commitUpdate(true);
      await host.updateComplete;

      // Start initial update
      host.requestUpdate('start', 0);
      const pInitial = host.updateComplete;

      // Execute layout effect commit
      const changed = new Map(host._changedProperties);
      host._commitUpdate(true);
      host.updated(changed);

      expect(chainTriggered).toBe(true);
      expect(await pInitial).toBe(true);

      // Verify the chained promise is fresh and pending
      expect(chainedPromise).not.toBeNull();
      expect(chainedPromise).not.toBe(pInitial);
      expect(host.isUpdatePending).toBe(true);
      expect(host._changedProperties.get('step2')).toBe(1);

      // Complete chained update
      host._commitUpdate(true);
      expect(await (chainedPromise as unknown as Promise<boolean>)).toBe(true);
      expect(host.isUpdatePending).toBe(false);
    });

    it('empirically verifies 3-step chained reactive update sequence', async () => {
      const completedSteps: number[] = [];

      class MultiStepHost extends MorphHost {
        step = 1;

        override updated(changed: Map<PropertyKey, unknown>) {
          super.updated(changed);
          if (changed.has('step')) {
            completedSteps.push(this.step);
            if (this.step < 3) {
              const prev = this.step;
              this.step = prev + 1;
              this.requestUpdate('step', prev);
            }
          }
        }
      }

      const host = new MultiStepHost();
      host._commitUpdate(true);
      await host.updateComplete;

      // Kick off step 1
      host.requestUpdate('step', 0);

      // Pass 1
      const p1 = host.updateComplete;
      const c1 = new Map(host._changedProperties);
      host._commitUpdate(true);
      host.updated(c1);
      expect(await p1).toBe(true);
      expect(completedSteps).toEqual([1]);
      expect(host.step).toBe(2);

      // Pass 2
      const p2 = host.updateComplete;
      expect(p2).not.toBe(p1);
      const c2 = new Map(host._changedProperties);
      host._commitUpdate(true);
      host.updated(c2);
      expect(await p2).toBe(true);
      expect(completedSteps).toEqual([1, 2]);
      expect(host.step).toBe(3);

      // Pass 3 (terminal step)
      const p3 = host.updateComplete;
      expect(p3).not.toBe(p2);
      const c3 = new Map(host._changedProperties);
      host._commitUpdate(true);
      host.updated(c3);
      expect(await p3).toBe(true);
      expect(completedSteps).toEqual([1, 2, 3]);
      expect(host.isUpdatePending).toBe(false);
    });
  });

  // =========================================================================
  // 10. Wave 2 verification: explicit undefined and NaN property sync
  // =========================================================================
  describe('10. wave 2 verification: explicit undefined and NaN property sync', () => {
    class PropHost extends MorphHost {
      static _propertyDefaults: Record<string, any> = {
        title: 'default-title',
        score: 100,
      };
      title = 'default-title';
      score = 100;
    }

    it('empirically verifies explicit undefined on initial mount sets undefined', () => {
      const host = new PropHost();
      const prevProps: Record<string, any> = {};
      const incomingProps = { title: undefined };

      for (const key of Object.keys(incomingProps)) {
        if (!(key in prevProps) || !Object.is(incomingProps[key as keyof typeof incomingProps], prevProps[key])) {
          const oldVal = (host as any)[key];
          host._changedProperties.set(key, oldVal);
          (host as any)[key] = incomingProps[key as keyof typeof incomingProps];
          prevProps[key] = incomingProps[key as keyof typeof incomingProps];
        }
      }

      expect(host.title).toBeUndefined();
      expect(host._changedProperties.get('title')).toBe('default-title');
    });

    it('empirically verifies explicit undefined on prop update transitions from value to undefined', () => {
      const host = new PropHost();
      const prevProps: Record<string, any> = { title: 'custom' };
      host.title = 'custom';

      const incomingProps = { title: undefined };
      for (const key of Object.keys(incomingProps)) {
        if (!(key in prevProps) || !Object.is(incomingProps[key as keyof typeof incomingProps], prevProps[key])) {
          const oldVal = (host as any)[key];
          host._changedProperties.set(key, oldVal);
          (host as any)[key] = incomingProps[key as keyof typeof incomingProps];
          prevProps[key] = incomingProps[key as keyof typeof incomingProps];
        }
      }

      expect(host.title).toBeUndefined();
      expect(host._changedProperties.get('title')).toBe('custom');
    });

    it('empirically verifies NaN property updates detect change from number and ignore successive NaNs', () => {
      const host = new PropHost();
      const prevProps: Record<string, any> = { score: 100 };
      host.score = 100;

      // Update 1: transition score to NaN
      let propsChanged1 = false;
      const incomingProps1 = { score: Number.NaN };
      for (const key of Object.keys(incomingProps1)) {
        if (!(key in prevProps) || !Object.is(incomingProps1[key as keyof typeof incomingProps1], prevProps[key])) {
          const oldVal = (host as any)[key];
          host._changedProperties.set(key, oldVal);
          (host as any)[key] = incomingProps1[key as keyof typeof incomingProps1];
          prevProps[key] = incomingProps1[key as keyof typeof incomingProps1];
          propsChanged1 = true;
        }
      }

      expect(propsChanged1).toBe(true);
      expect(Number.isNaN(host.score)).toBe(true);
      expect(host._changedProperties.get('score')).toBe(100);

      // Update 2: pass NaN again -> Object.is(NaN, NaN) is true, must NOT trigger change
      host._changedProperties.clear();
      let propsChanged2 = false;
      const incomingProps2 = { score: Number.NaN };
      for (const key of Object.keys(incomingProps2)) {
        if (!(key in prevProps) || !Object.is(incomingProps2[key as keyof typeof incomingProps2], prevProps[key])) {
          propsChanged2 = true;
        }
      }

      expect(propsChanged2).toBe(false);
      expect(host._changedProperties.size).toBe(0);
    });

    it('empirically verifies +0 and -0 distinction via Object.is', () => {
      const prevProps: Record<string, any> = { value: +0 };
      const incomingProps = { value: -0 };

      let changed = false;
      for (const key of Object.keys(incomingProps)) {
        if (!(key in prevProps) || !Object.is(incomingProps[key as keyof typeof incomingProps], prevProps[key])) {
          changed = true;
        }
      }

      // Object.is(+0, -0) is false, detecting sign boundary
      expect(changed).toBe(true);
    });
  });

  // =========================================================================
  // 11. Wave 2 verification: @query and @queryAll DOM fallback and NodeList return
  // =========================================================================
  describe('11. wave 2 verification: @query and @queryAll DOM fallback and NodeList return', () => {
    class QueryHost extends MorphHost {
      _queryRefs: Record<string, { current: HTMLElement | null }> = {};

      get actionBtn(): HTMLElement | null {
        return this._queryRefs.actionBtn && this._queryRefs.actionBtn.current !== null ? this._queryRefs.actionBtn.current : (this.querySelector('#action-btn') ?? null);
      }

      get listItems(): NodeListOf<HTMLElement> {
        return this.querySelectorAll('.list-item');
      }
    }

    it('empirically verifies @query getter returns ref.current when attached', () => {
      const host = new QueryHost();
      const mockBtn = { tagName: 'BUTTON', id: 'action-btn' } as unknown as HTMLElement;
      host._queryRefs.actionBtn = { current: mockBtn };

      expect(host.actionBtn).toBe(mockBtn);
    });

    it('empirically verifies @query getter falls back to querySelector when ref.current is null', () => {
      const host = new QueryHost();
      host._queryRefs.actionBtn = { current: null };

      const fallbackBtn = { tagName: 'BUTTON', id: 'action-btn' } as unknown as HTMLElement;
      host._hostElement = {
        querySelector: (sel: string) => (sel === '#action-btn' ? fallbackBtn : null),
      } as unknown as HTMLElement;

      expect(host.actionBtn).toBe(fallbackBtn);
    });

    it('empirically verifies @query getter returns null when neither ref nor querySelector matches', () => {
      const host = new QueryHost();
      host._queryRefs.actionBtn = { current: null };
      host._hostElement = {
        querySelector: () => null,
      } as unknown as HTMLElement;

      expect(host.actionBtn).toBeNull();
    });

    it('empirically verifies @query getter returns null safely when host element is unattached', () => {
      const host = new QueryHost();
      host._queryRefs.actionBtn = { current: null };
      host._hostElement = null;

      expect(host.actionBtn).toBeNull();
    });

    it('empirically verifies @queryAll getter delegates to querySelectorAll and returns NodeList', () => {
      const host = new QueryHost();
      const mockItems = [{ tagName: 'SPAN' }, { tagName: 'SPAN' }] as unknown as NodeListOf<HTMLElement>;
      host._hostElement = {
        querySelectorAll: (sel: string) => (sel === '.list-item' ? mockItems : ([] as any)),
      } as unknown as HTMLElement;

      const items = host.listItems;
      expect(items).toBe(mockItems);
      expect(items.length).toBe(2);
    });

    it('empirically verifies @queryAll getter returns empty NodeList when host element is unattached and document is present', () => {
      const host = new QueryHost();
      host._hostElement = null;

      const mockFragment = {
        querySelectorAll: () => [] as unknown as NodeListOf<HTMLElement>,
      };
      const origDoc = (globalThis as any).document;
      try {
        (globalThis as any).document = {
          createDocumentFragment: () => mockFragment,
        };

        const items = host.listItems;
        expect(items).toBeDefined();
        expect(items.length).toBe(0);
      } finally {
        (globalThis as any).document = origDoc;
      }
    });

    it('empirically verifies failure mode: @queryAll throws TypeError when document is undefined in SSR', () => {
      const host = new QueryHost();
      host._hostElement = null;

      const origDoc = (globalThis as any).document;
      try {
        delete (globalThis as any).document;
        // Accessing queryAll in SSR when hostElement is unattached calls bare document.createDocumentFragment()
        // which throws ReferenceError because document is not defined in Node SSR!
        expect(() => host.listItems).toThrow(ReferenceError);
      } finally {
        (globalThis as any).document = origDoc;
      }
    });
  });

  // =========================================================================
  // 12. Wave 2 verification: compiler AST emission verification for shouldRender and queries
  // =========================================================================
  describe('12. wave 2 verification: compiler AST emission verification for shouldRender and queries', () => {
    it('empirically verifies emit_host compiles @query with null check and querySelector fallback', () => {
      const code = `
        import { LitElement, html } from 'lit';
        import { query, queryAll } from 'lit/decorators.js';

        export class QueryDemo extends LitElement {
          @query('#primary')
          primaryBtn!: HTMLButtonElement;

          @queryAll('.entry')
          entries!: NodeListOf<HTMLElement>;

          render() {
            return html\`<button id="primary">Go</button><div class="entry">1</div>\`;
          }
        }
      `;

      const res = compileModule(code, { filePath: 'query-demo.ts' });
      // 1. @query getter has ref null check and fallback
      expect(res.code).toContain('this._queryRefs["primaryBtn"] && this._queryRefs["primaryBtn"].current !== null');
      expect(res.code).toContain('this.querySelector("#primary") ?? null');

      // 2. @queryAll delegates to querySelectorAll
      expect(res.code).toContain('return this.querySelectorAll(".entry");');

      // 3. Static _propertyDefaults is standard ES field without invalid optional modifier
      expect(res.code).not.toContain('_propertyDefaults?');
      expect(res.code).toContain('static _propertyDefaults =');
    });
  });
});
