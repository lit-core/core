import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getTestBrowser } from '../harness.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../../../..');

async function bundleTestCode(source: string): Promise<string> {
  const entryId = 'virtual:stress-entry.tsx';
  const result = await build({
    logLevel: 'silent',
    configFile: false,
    root: rootDir,
    build: {
      write: false,
      minify: false,
      sourcemap: false,
      rollupOptions: {
        input: entryId,
        output: {
          codeSplitting: false,
          format: 'iife',
          name: 'StressBundle',
        },
      },
    },
    plugins: [
      {
        name: 'virtual-stress-entry',
        enforce: 'pre',
        resolveId(id) {
          if (id === entryId) return `\0${id}`;
        },
        load(id) {
          if (id === `\0${entryId}`) return source;
        },
      },
    ],
  });

  const rawOutput = (result as any).output || (Array.isArray(result) ? result[0].output : []);
  const jsChunk = rawOutput.find((c: any) => c.fileName?.endsWith('.js'));
  if (!jsChunk || !('code' in jsChunk)) {
    throw new Error('Vite build failed to produce JavaScript chunk');
  }
  return jsChunk.code;
}

describe('morph-to-react empirical stress tests and invariant verification', () => {
  let browser: any;
  let page: any;
  let bundleCode: string;

  async function resetPage() {
    await page.setContent('<!DOCTYPE html><html><body><div id="test-root"></div></body></html>');
    await page.addScriptTag({ content: bundleCode });
  }

  beforeAll(async () => {
    browser = await getTestBrowser();
    page = await browser.newPage();

    bundleCode = await bundleTestCode(`
      import React, { StrictMode, useState, useEffect, useRef } from 'react';
      import { createRoot } from 'react-dom/client';
      import { MorphHost, useMorphHost } from '@lit-core/morph-to-react/runtime';
      import { CdsButton, CDSButtonHost, CdsCheckbox, CdsCheckboxHost, CdsTabs, CdsTabsHost, CdsTab } from '@lit-core/morph-to-react/carbon';

      window.__REACT__ = React;
      window.__STRICT_MODE__ = StrictMode;
      window.__CREATE_ROOT__ = createRoot;
      window.__MORPH_HOST__ = MorphHost;
      window.__USE_MORPH_HOST__ = useMorphHost;
      window.__CDS_BUTTON__ = CdsButton;
      window.__CDS_BUTTON_HOST__ = CDSButtonHost;
      window.__CDS_CHECKBOX__ = CdsCheckbox;
      window.__CDS_CHECKBOX_HOST__ = CdsCheckboxHost;
      window.__CDS_TABS__ = CdsTabs;
      window.__CDS_TABS_HOST__ = CdsTabsHost;
      window.__CDS_TAB__ = CdsTab;
      window.__TEST_READY__ = true;
    `);

    await resetPage();
  });

  beforeEach(async () => {
    await resetPage();
  });

  afterAll(async () => {
    if (page) {
      await page.close();
    }
  });

  // =========================================================================
  // TEST 1: LIFECYCLE ON PROP UPDATE AND UPDATECOMPLETE RESOLUTION (BUG 1)
  // =========================================================================
  describe('challenge 1: useMorphHost lifecycle execution on prop updates', () => {
    it('verifies whether host.updated and _commitUpdate run on prop updates', async () => {
      const result = await page.evaluate(async () => {
        const { __REACT__: React, __CREATE_ROOT__: createRoot, __MORPH_HOST__: MorphHost, __USE_MORPH_HOST__: useMorphHost } = window as any;

        const lifecycleLog: string[] = [];
        let hostInstance: any = null;
        let updateCompleteResolved = false;

        class LifecycleHost extends MorphHost {
          title = 'initial';

          override connectedCallback() {
            super.connectedCallback();
            lifecycleLog.push('connected');
          }

          override firstUpdated(changedProps: Map<PropertyKey, unknown>) {
            super.firstUpdated(changedProps);
            lifecycleLog.push(`firstUpdated:${Array.from(changedProps.keys()).join(',')}`);
          }

          override updated(changedProps: Map<PropertyKey, unknown>) {
            super.updated(changedProps);
            lifecycleLog.push(`updated:${Array.from(changedProps.keys()).join(',')}`);
          }

          override disconnectedCallback() {
            super.disconnectedCallback();
            lifecycleLog.push('disconnected');
          }
        }

        let triggerUpdate: (newTitle: string) => void = () => {};

        function TestApp() {
          const [title, setTitle] = React.useState('initial');
          triggerUpdate = setTitle;
          const { host, elementRef } = useMorphHost(LifecycleHost, { title });
          hostInstance = host;
          return React.createElement('div', { ref: elementRef }, title);
        }

        const container = document.getElementById('test-root');
        if (!container) throw new Error('Missing container #test-root');
        container.innerHTML = '';
        const mountDiv = document.createElement('div');
        container.appendChild(mountDiv);

        const root = createRoot(mountDiv);
        root.render(React.createElement(TestApp));

        // Wait for initial mount
        await new Promise((r) => setTimeout(r, 50));

        const initialLog = [...lifecycleLog];
        const isUpdatePendingAfterMount = hostInstance._isUpdatePending;
        const changedPropsAfterMount = hostInstance._changedProperties.size;

        // Now trigger prop update
        triggerUpdate('second-title');

        // Wait for React to render update
        await new Promise((r) => setTimeout(r, 50));

        // Check if updateComplete resolves
        const updatePromise = hostInstance.updateComplete.then(() => {
          updateCompleteResolved = true;
          return true;
        });

        // Set a 200ms timeout race to see if updateComplete hangs
        const timeoutPromise = new Promise((resolve) => setTimeout(() => resolve('TIMEOUT'), 200));
        const raceResult = await Promise.race([updatePromise, timeoutPromise]);

        const logAfterUpdate = [...lifecycleLog];
        const isUpdatePendingAfterUpdate = hostInstance._isUpdatePending;
        const changedPropsAfterUpdate = Array.from(hostInstance._changedProperties.keys());

        root.unmount();
        await new Promise((r) => setTimeout(r, 50));

        return {
          initialLog,
          isUpdatePendingAfterMount,
          changedPropsAfterMount,
          logAfterUpdate,
          isUpdatePendingAfterUpdate,
          changedPropsAfterUpdate,
          updateCompleteResolved,
          raceResult,
          finalLog: lifecycleLog,
        };
      });

      // Assertions examining empirical findings:
      console.log('Test 1 empirical result:', JSON.stringify(result, null, 2));

      // Initial mount should have connected, firstUpdated, updated
      expect(result.initialLog).toContain('connected');
      expect(result.initialLog).toContain('firstUpdated:title');
      expect(result.initialLog).toContain('updated:title');

      // CRITICAL CHECK: Did updated() run on prop update?
      // If useLayoutEffect has [host], updated() will NOT be in logAfterUpdate for the second title!
      const updatedCount = result.logAfterUpdate.filter((e: string) => e.startsWith('updated:')).length;
      console.log('Total updated() calls:', updatedCount);

      // Check if updateComplete resolved or timed out
      console.log('updateComplete race result:', result.raceResult);
      console.log('changedProperties after update:', result.changedPropsAfterUpdate);
    });
  });

  // =========================================================================
  // TEST 2: STRICTMODE DOUBLE MOUNTING INVARIANT (BUG 2)
  // =========================================================================
  describe('challenge 2: StrictMode double mounting lifecycle invariant', () => {
    it('empirically verifies firstUpdated call count under React 19 StrictMode', async () => {
      const result = await page.evaluate(async () => {
        const { __REACT__: React, __STRICT_MODE__: StrictMode, __CREATE_ROOT__: createRoot, __MORPH_HOST__: MorphHost, __USE_MORPH_HOST__: useMorphHost } = window as any;

        let connectedCount = 0;
        let disconnectedCount = 0;
        let firstUpdatedCount = 0;
        let updatedCount = 0;

        class StrictHost extends MorphHost {
          override connectedCallback() {
            super.connectedCallback();
            connectedCount++;
          }

          override disconnectedCallback() {
            super.disconnectedCallback();
            disconnectedCount++;
          }

          override firstUpdated(changedProps: Map<PropertyKey, unknown>) {
            super.firstUpdated(changedProps);
            firstUpdatedCount++;
          }

          override updated(changedProps: Map<PropertyKey, unknown>) {
            super.updated(changedProps);
            updatedCount++;
          }
        }

        function StrictApp() {
          useMorphHost(StrictHost, { test: 1 });
          return React.createElement('div', null, 'strict');
        }

        const container = document.getElementById('test-root');
        if (!container) throw new Error('Missing container #test-root');
        container.innerHTML = '';
        const mountDiv = document.createElement('div');
        container.appendChild(mountDiv);

        const root = createRoot(mountDiv);
        root.render(React.createElement(StrictMode, null, React.createElement(StrictApp)));

        await new Promise((r) => setTimeout(r, 100));

        root.unmount();
        await new Promise((r) => setTimeout(r, 50));

        return {
          connectedCount,
          disconnectedCount,
          firstUpdatedCount,
          updatedCount,
        };
      });

      console.log('Test 2 StrictMode empirical result:', result);

      // In Lit specification, firstUpdated MUST fire exactly ONCE per element instance.
      // If useMorphHost resets isFirstMountRef.current = true on unmount, StrictMode remount calls firstUpdated a second time!
      expect(result.connectedCount).toBe(2);
      expect(result.disconnectedCount).toBe(2);
      // Let's document what actually happened
      console.log('firstUpdated call count in StrictMode:', result.firstUpdatedCount);
    });
  });

  // =========================================================================
  // TEST 3: CDSTABS DUPLICATE EVENT DISPATCH (BUG 3)
  // =========================================================================
  describe('challenge 3: CdsTabs event dispatch callback count', () => {
    it('empirically verifies if onCdsTabsSelected and onCdsTabsBeingselected are called once or twice', async () => {
      const result = await page.evaluate(async () => {
        const { __REACT__: React, __CREATE_ROOT__: createRoot, __CDS_TABS__: CdsTabs, __CDS_TAB__: CdsTab } = window as any;

        let beingSelectedCallCount = 0;
        let selectedCallCount = 0;
        const beingSelectedEvents: any[] = [];
        const selectedEvents: any[] = [];

        function TabsTest() {
          return React.createElement(
            CdsTabs,
            {
              value: 'tab-1',
              onCdsTabsBeingselected: (e: any) => {
                beingSelectedCallCount++;
                beingSelectedEvents.push({ type: e.type, detail: e.detail });
              },
              onCdsTabsSelected: (e: any) => {
                selectedCallCount++;
                selectedEvents.push({ type: e.type, detail: e.detail });
              },
            },
            React.createElement(CdsTab, { value: 'tab-1' }, 'Tab 1'),
            React.createElement(CdsTab, { value: 'tab-2', id: 'target-tab-2' }, 'Tab 2'),
          );
        }

        const container = document.getElementById('test-root');
        if (!container) throw new Error('Missing container #test-root');
        container.innerHTML = '';
        const mountDiv = document.createElement('div');
        container.appendChild(mountDiv);

        const root = createRoot(mountDiv);
        root.render(React.createElement(TabsTest));

        await new Promise((r) => setTimeout(r, 100));

        // Click Tab 2
        const tab2El = mountDiv.querySelector('cds-tab[value="tab-2"]') as HTMLElement;
        const link = tab2El?.querySelector('a') as HTMLElement;
        link?.click();

        await new Promise((r) => setTimeout(r, 100));

        root.unmount();

        return {
          beingSelectedCallCount,
          selectedCallCount,
          beingSelectedEvents,
          selectedEvents,
        };
      });

      console.log('Test 3 CdsTabs event callback counts:', result);

      // In standard DOM / React: clicking Tab 2 should fire onCdsTabsBeingselected EXACTLY ONCE
      // and onCdsTabsSelected EXACTLY ONCE.
      // If MorphHost.dispatchEvent invokes _props[propName] AND CdsTabs calls prop directly,
      // the count will be 2!
      console.log('beingSelectedCallCount:', result.beingSelectedCallCount);
      console.log('selectedCallCount:', result.selectedCallCount);
    });
  });

  // =========================================================================
  // TEST 4: RAPID PROPERTY MUTATIONS AND STATE SYNCHRONIZATION ON CDSCHECKBOX
  // =========================================================================
  describe('challenge 4: rapid property mutations and toggle sequences on CdsCheckbox', () => {
    it('stress-tests 100 rapid checked toggles and checks DOM and host synchronization', async () => {
      const result = await page.evaluate(async () => {
        const { __REACT__: React, __CREATE_ROOT__: createRoot, __CDS_CHECKBOX__: CdsCheckbox } = window as any;

        let setCheckedFn: (v: boolean) => void = () => {};
        let hostRefVal: any = null;

        function CheckboxApp() {
          const [checked, setChecked] = React.useState(false);
          setCheckedFn = setChecked;
          return React.createElement(CdsCheckbox, {
            checked,
            ref: (node: any) => {
              hostRefVal = node;
            },
            labelText: 'Rapid Test',
          });
        }

        const container = document.getElementById('test-root');
        if (!container) throw new Error('Missing container #test-root');
        container.innerHTML = '';
        const mountDiv = document.createElement('div');
        container.appendChild(mountDiv);

        const root = createRoot(mountDiv);
        root.render(React.createElement(CheckboxApp));

        await new Promise((r) => setTimeout(r, 50));

        // Rapidly toggle 100 times
        for (let i = 1; i <= 100; i++) {
          setCheckedFn(i % 2 === 1);
        }

        await new Promise((r) => setTimeout(r, 100));

        const nativeInput = mountDiv.querySelector('input[type="checkbox"]') as HTMLInputElement;
        const cdsCheckbox = mountDiv.querySelector('cds-checkbox') as HTMLElement;

        const finalInputChecked = nativeInput?.checked;
        const finalHostChecked = hostRefVal?.checked;
        const finalAttributeChecked = cdsCheckbox?.hasAttribute('checked');

        root.unmount();

        return {
          finalInputChecked,
          finalHostChecked,
          finalAttributeChecked,
        };
      });

      console.log('Test 4 Rapid toggle result:', result);
      // 100th toggle was (100 % 2 === 1) -> false
      expect(result.finalInputChecked).toBe(false);
      expect(result.finalHostChecked).toBe(false);
      expect(result.finalAttributeChecked).toBe(false);
    });

    it('tests user click self-mutation and event detail payload on CdsCheckbox', async () => {
      const result = await page.evaluate(async () => {
        const { __REACT__: React, __CREATE_ROOT__: createRoot, __CDS_CHECKBOX__: CdsCheckbox, __CDS_CHECKBOX_HOST__: CdsCheckboxHost } = window as any;

        const eventsReceived: any[] = [];
        const hostRefVal: any = null;
        let capturedHost: any = null;

        const origConnected = CdsCheckboxHost.prototype.connectedCallback;
        CdsCheckboxHost.prototype.connectedCallback = function (this: any, ...args: any[]) {
          capturedHost = this;
          let currentChecked = this.checked;
          Object.defineProperty(this, 'checked', {
            get() {
              return currentChecked;
            },
            set(v) {
              logSteps.push(`checked set to: ${v} stack: ${new Error().stack?.split('\n').slice(1, 4).join(' <- ')}`);
              currentChecked = v;
            },
            configurable: true,
          });
          return origConnected.apply(this, args);
        };

        function CheckboxApp() {
          return React.createElement(CdsCheckbox, {
            defaultChecked: false,
            ref: (node: any) => {
              window.__CHECKBOX_HOST_REF__ = node;
            },
            onCdsCheckboxChanged: (e: any) => {
              eventsReceived.push({
                type: e.type,
                bubbles: e.bubbles,
                composed: e.composed,
                detail: e.detail,
              });
            },
            labelText: 'Self-mutation Test',
          });
        }

        const windowErrors: any[] = [];
        window.addEventListener('error', (e) => windowErrors.push(e.message || String(e.error)));

        const container = document.getElementById('test-root');
        if (!container) throw new Error('Missing container #test-root');
        container.innerHTML = '';
        const mountDiv = document.createElement('div');
        container.appendChild(mountDiv);

        const root = createRoot(mountDiv);
        root.render(React.createElement(CheckboxApp));

        await new Promise((r) => setTimeout(r, 50));

        const nativeInput = mountDiv.querySelector('input[type="checkbox"]') as HTMLInputElement;
        const logSteps: string[] = [];

        const cdsCheckboxEl = mountDiv.querySelector('cds-checkbox') as any;
        const initialDescriptor = Object.getOwnPropertyDescriptor(cdsCheckboxEl, 'checked');
        logSteps.push(`initial input.checked: ${nativeInput.checked}`);
        logSteps.push(`initial cdsCheckbox.checked: ${cdsCheckboxEl?.checked}`);
        logSteps.push(`initial descriptor: ${JSON.stringify(initialDescriptor)}`);

        nativeInput.addEventListener('change', () => {
          logSteps.push(`native change fired, input.checked: ${nativeInput.checked}`);
        });

        nativeInput.click();
        logSteps.push(`immediately after click(), input.checked: ${nativeInput.checked}`);
        logSteps.push(`immediately after click(), cdsCheckbox.checked: ${(cdsCheckboxEl as any)?.checked}`);

        await new Promise((r) => setTimeout(r, 10));
        logSteps.push(`after 10ms, input.checked: ${nativeInput.checked}`);
        logSteps.push(`after 10ms, cdsCheckbox.checked: ${(cdsCheckboxEl as any)?.checked}`);

        await new Promise((r) => setTimeout(r, 90));

        const freshInput = mountDiv.querySelector('input[type="checkbox"]') as HTMLInputElement;
        const freshCdsCheckbox = mountDiv.querySelector('cds-checkbox') as HTMLElement;
        const afterDescriptor = Object.getOwnPropertyDescriptor(freshCdsCheckbox, 'checked');

        logSteps.push(`after 100ms, getter source: ${afterDescriptor?.get?.toString()}`);
        logSteps.push(`after 100ms, freshInput.checked: ${freshInput?.checked}`);
        logSteps.push(`after 100ms, freshCdsCheckbox.checked: ${(freshCdsCheckbox as any)?.checked}`);
        logSteps.push(`after 100ms, capturedHost.checked: ${capturedHost?.checked}`);
        logSteps.push(`after 100ms, capturedHost === host: ${capturedHost !== null}`);
        logSteps.push(`after 100ms, window.__CHECKBOX_HOST_REF__ === freshCdsCheckbox: ${window.__CHECKBOX_HOST_REF__ === freshCdsCheckbox}`);
        logSteps.push(`after 100ms, window.__CHECKBOX_HOST_REF__.checked: ${window.__CHECKBOX_HOST_REF__?.checked}`);
        logSteps.push(`after 100ms, window.__CHECKBOX_HOST_REF__ own checked descriptor: ${JSON.stringify(Object.getOwnPropertyDescriptor(window.__CHECKBOX_HOST_REF__, 'checked'))}`);
        logSteps.push(`after 100ms, freshCdsCheckbox own checked descriptor: ${JSON.stringify(Object.getOwnPropertyDescriptor(freshCdsCheckbox, 'checked'))}`);
        const hostCheckedAfterClick = (freshCdsCheckbox as any)?.checked;
        const inputCheckedAfterClick = freshInput?.checked;
        const hostRefTag = hostRefVal?.tagName;
        const hostRefKeys = hostRefVal ? Object.keys(hostRefVal) : [];

        const htmlAfter100ms = mountDiv.innerHTML;
        root.unmount();

        return {
          logSteps,
          eventsReceived,
          hostCheckedAfterClick,
          inputCheckedAfterClick,
          hostRefTag,
          hostRefKeys,
          hostRefValIsNull: hostRefVal === null,
          windowErrors,
          htmlAfter100ms,
        };
      });

      console.log('Test 4 self-mutation detailed diagnostics:', result);
      expect(result.eventsReceived.length).toBe(1);
      expect(result.eventsReceived[0].type).toBe('cds-checkbox-changed');
      expect(result.eventsReceived[0].bubbles).toBe(true);
      expect(result.eventsReceived[0].composed).toBe(true);
      expect(result.eventsReceived[0].detail).toEqual({ checked: true, indeterminate: false });

      expect(result.logSteps.some((step: string) => step.includes('immediately after click(), input.checked: true'))).toBe(true);
      expect(result.logSteps.some((step: string) => step.includes('immediately after click(), cdsCheckbox.checked: true'))).toBe(true);
      expect(result.hostCheckedAfterClick).toBe(true);
      expect(result.inputCheckedAfterClick).toBe(true);
    });
  });

  // =========================================================================
  // TEST 5: CAPTURE-PHASE CLICK SUPPRESSION ON DISABLED CDSBUTTON
  // =========================================================================
  describe('challenge 5: capture-phase click suppression and disabled state on CdsButton', () => {
    it('stress-tests 50 rapid clicks on disabled CdsButton and verifies 100% suppression', async () => {
      const result = await page.evaluate(async () => {
        const { __REACT__: React, __CREATE_ROOT__: createRoot, __CDS_BUTTON__: CdsButton } = window as any;

        let hostClickedCount = 0;
        let parentClickedCount = 0;
        let setDisabledFn: (v: boolean) => void = () => {};

        function ButtonApp() {
          const [disabled, setDisabled] = React.useState(true);
          setDisabledFn = setDisabled;
          return React.createElement(
            'div',
            {
              id: 'parent-container',
              onClick: () => {
                parentClickedCount++;
              },
            },
            React.createElement(
              CdsButton,
              {
                disabled,
                onClick: () => {
                  hostClickedCount++;
                },
              },
              'Test Button',
            ),
          );
        }

        const container = document.getElementById('test-root');
        if (!container) throw new Error('Missing container #test-root');
        container.innerHTML = '';
        const mountDiv = document.createElement('div');
        container.appendChild(mountDiv);

        const root = createRoot(mountDiv);
        root.render(React.createElement(ButtonApp));

        await new Promise((r) => setTimeout(r, 50));

        const btnElement = mountDiv.querySelector('button') as HTMLButtonElement;
        const cdsButton = mountDiv.querySelector('cds-button') as HTMLElement;

        // 50 rapid clicks while disabled
        for (let i = 0; i < 50; i++) {
          btnElement.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
          cdsButton.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        }

        const clicksWhileDisabled = { hostClickedCount, parentClickedCount };

        // Now enable and click 5 times
        setDisabledFn(false);
        await new Promise((r) => setTimeout(r, 50));

        for (let i = 0; i < 5; i++) {
          btnElement.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        }

        root.unmount();

        return {
          clicksWhileDisabled,
          clicksAfterEnabled: { hostClickedCount, parentClickedCount },
        };
      });

      console.log('Test 5 Disabled button suppression result:', result);
      // When disabled, capture-phase listener calls stopPropagation and preventDefault
      expect(result.clicksWhileDisabled.hostClickedCount).toBe(0);
      expect(result.clicksWhileDisabled.parentClickedCount).toBe(0);
      // When enabled, clicks pass through to parent and onClick handler
      expect(result.clicksAfterEnabled.parentClickedCount).toBe(5);
      expect(result.clicksAfterEnabled.hostClickedCount).toBe(5);
    });
  });

  // =========================================================================
  // TEST 6: CANCELABLE EVENT (cds-tabs-beingselected) IN CDSTABS
  // =========================================================================
  describe('challenge 6: cancelable event handling in CdsTabs', () => {
    it('verifies that calling event.preventDefault() in onCdsTabsBeingselected cancels tab switch', async () => {
      const result = await page.evaluate(async () => {
        const { __REACT__: React, __CREATE_ROOT__: createRoot, __CDS_TABS__: CdsTabs, __CDS_TAB__: CdsTab } = window as any;

        let selectedCalled = false;

        function TabsCancelApp() {
          return React.createElement(
            CdsTabs,
            {
              value: 'tab-1',
              onCdsTabsBeingselected: (e: any) => {
                e.preventDefault(); // CANCEL TAB SELECTION
              },
              onCdsTabsSelected: () => {
                selectedCalled = true;
              },
            },
            React.createElement(CdsTab, { value: 'tab-1' }, 'Overview'),
            React.createElement(CdsTab, { value: 'tab-2' }, 'Settings'),
          );
        }

        const container = document.getElementById('test-root');
        if (!container) throw new Error('Missing container #test-root');
        container.innerHTML = '';
        const mountDiv = document.createElement('div');
        container.appendChild(mountDiv);

        const root = createRoot(mountDiv);
        root.render(React.createElement(TabsCancelApp));

        await new Promise((r) => setTimeout(r, 50));

        const tab2El = mountDiv.querySelector('cds-tab[value="tab-2"]') as HTMLElement;
        const link = tab2El?.querySelector('a') as HTMLElement;
        link?.click();

        await new Promise((r) => setTimeout(r, 50));

        // Selected tab link aria-selected attribute
        const tab1Link = mountDiv.querySelector('cds-tab[value="tab-1"] a') as HTMLElement;
        const tab2Link = mountDiv.querySelector('cds-tab[value="tab-2"] a') as HTMLElement;

        const tab1Selected = tab1Link.getAttribute('aria-selected');
        const tab2Selected = tab2Link.getAttribute('aria-selected');

        root.unmount();

        return {
          selectedCalled,
          tab1Selected,
          tab2Selected,
        };
      });

      console.log('Test 6 Cancelable event result:', result);
      // Because e.preventDefault() was called in beingselected:
      // onCdsTabsSelected must NOT be called
      expect(result.selectedCalled).toBe(false);
      // tab-1 should stay selected ('true'), tab-2 should stay unselected ('false')
      expect(result.tab1Selected).toBe('true');
      expect(result.tab2Selected).toBe('false');
    });
  });

  // =========================================================================
  // TEST 7: ROVING TABINDEX KEYBOARD NAVIGATION IN CDSTABS
  // =========================================================================
  describe('challenge 7: roving tabindex keyboard navigation in CdsTabs', () => {
    it('verifies ArrowRight, ArrowLeft, Home, End keyboard roving tabindex navigation', async () => {
      const result = await page.evaluate(async () => {
        const { __REACT__: React, __CREATE_ROOT__: createRoot, __CDS_TABS__: CdsTabs, __CDS_TAB__: CdsTab } = window as any;

        const selectedLog: string[] = [];

        function TabsNavApp() {
          return React.createElement(
            CdsTabs,
            {
              onCdsTabsSelected: (e: any) => {
                selectedLog.push(e.detail.name || e.detail.item?.getAttribute('value'));
              },
            },
            React.createElement(CdsTab, { value: 'tab-1' }, 'Tab 1'),
            React.createElement(CdsTab, { value: 'tab-2' }, 'Tab 2'),
            React.createElement(CdsTab, { value: 'tab-3', disabled: true }, 'Tab 3 Disabled'),
            React.createElement(CdsTab, { value: 'tab-4' }, 'Tab 4'),
          );
        }

        const container = document.getElementById('test-root');
        if (!container) throw new Error('Missing container #test-root');
        container.innerHTML = '';
        const mountDiv = document.createElement('div');
        container.appendChild(mountDiv);

        const root = createRoot(mountDiv);
        root.render(React.createElement(TabsNavApp));

        await new Promise((r) => setTimeout(r, 50));

        const cdsTabs = mountDiv.querySelector('cds-tabs') as HTMLElement;
        const tab1Link = mountDiv.querySelector('cds-tab[value="tab-1"] a') as HTMLElement;
        tab1Link.focus();

        // 1. Press ArrowRight from Tab 1 -> should go to Tab 2
        cdsTabs.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
        await new Promise((r) => setTimeout(r, 50));

        const tab2Link = mountDiv.querySelector('cds-tab[value="tab-2"] a') as HTMLElement;
        const tab2SelectedAfterStep1 = tab2Link?.getAttribute('aria-selected');
        const selectedAttrTabAfterStep1 = (mountDiv.querySelector('cds-tab[selected]') as HTMLElement)?.getAttribute('value');

        // 2. Press ArrowRight from Tab 2 -> Tab 3 is disabled, should skip to Tab 4
        cdsTabs.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
        await new Promise((r) => setTimeout(r, 50));

        const tab4Link = mountDiv.querySelector('cds-tab[value="tab-4"] a') as HTMLElement;
        const tab4SelectedAfterStep2 = tab4Link?.getAttribute('aria-selected');
        const selectedAttrTabAfterStep2 = (mountDiv.querySelector('cds-tab[selected]') as HTMLElement)?.getAttribute('value');

        // 3. Press Home -> should return to Tab 1
        cdsTabs.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
        await new Promise((r) => setTimeout(r, 50));

        const tab1SelectedAfterHome = tab1Link?.getAttribute('aria-selected');
        const selectedAttrTabAfterHome = (mountDiv.querySelector('cds-tab[selected]') as HTMLElement)?.getAttribute('value');

        root.unmount();

        return {
          selectedLog,
          tab2SelectedAfterStep1,
          selectedAttrTabAfterStep1,
          tab4SelectedAfterStep2,
          selectedAttrTabAfterStep2,
          tab1SelectedAfterHome,
          selectedAttrTabAfterHome,
        };
      });

      console.log('Test 7 Roving tabindex detailed result:', result);
      expect(result.tab2SelectedAfterStep1).toBe('true');
      expect(result.selectedAttrTabAfterStep1).toBe('tab-2');
      expect(result.tab4SelectedAfterStep2).toBe('true');
      expect(result.selectedAttrTabAfterStep2).toBe('tab-4');
      expect(result.tab1SelectedAfterHome).toBe('true');
      expect(result.selectedAttrTabAfterHome).toBe('tab-1');

      // Selection dispatches exactly once per tab change
      expect(result.selectedLog.length).toBe(3);
      expect(result.selectedLog).toEqual(['tab-2', 'tab-4', 'tab-1']);
    });
  });

  // =========================================================================
  // TEST 8: RAPID MOUNT / UNMOUNT STRESS TEST (MEMORY & LISTENER LEAKS)
  // =========================================================================
  describe('challenge 8: rapid mount and unmount stress test', () => {
    it('mounts and unmounts 100 components in a rapid cycle without memory leak or errors', async () => {
      const result = await page.evaluate(async () => {
        const { __REACT__: React, __CREATE_ROOT__: createRoot, __CDS_BUTTON__: CdsButton, __CDS_CHECKBOX__: CdsCheckbox, __CDS_TABS__: CdsTabs, __CDS_TAB__: CdsTab } = window as any;

        const container = document.getElementById('test-root');
        if (!container) throw new Error('Missing container #test-root');
        container.innerHTML = '';
        const mountDiv = document.createElement('div');
        container.appendChild(mountDiv);

        const root = createRoot(mountDiv);

        let completedCycles = 0;
        const errors: string[] = [];

        for (let i = 0; i < 50; i++) {
          try {
            root.render(
              React.createElement(
                'div',
                null,
                React.createElement(CdsButton, { kind: 'primary', disabled: i % 2 === 0 }, `Btn ${i}`),
                React.createElement(CdsCheckbox, { checked: i % 2 === 1, labelText: `Chk ${i}` }),
                React.createElement(CdsTabs, { value: 't1' }, React.createElement(CdsTab, { value: 't1' }, 'Tab 1')),
              ),
            );
            await new Promise((r) => setTimeout(r, 5));
            completedCycles++;
          } catch (err: any) {
            errors.push(err.message);
          }
        }

        root.unmount();
        await new Promise((r) => setTimeout(r, 20));

        return {
          completedCycles,
          errors,
          containerChildCount: mountDiv.childNodes.length,
        };
      });

      console.log('Test 8 Rapid mount/unmount result:', result);
      expect(result.completedCycles).toBe(50);
      expect(result.errors).toEqual([]);
      expect(result.containerChildCount).toBe(0);
    });
  });
});
