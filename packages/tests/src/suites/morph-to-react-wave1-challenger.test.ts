import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getTestBrowser } from '../harness.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../../../..');

async function bundleClientCode(): Promise<string> {
  const entryId = 'virtual:wave1-challenger-entry.tsx';
  const entrySource = `
    import React, { StrictMode, useState, useEffect, useRef } from 'react';
    import { createRoot } from 'react-dom/client';
    import { flushSync } from 'react-dom';
    import {
      CdsButton,
      CDSButtonHost,
      CdsCheckbox,
      CdsCheckboxHost,
      CdsTabs,
      CdsTabsHost,
      CdsTab,
      CdsTabHost,
      buttonStyles,
      checkboxStyles,
      tabsStyles,
    } from '@lit-core/morph-to-react/carbon';
    import { MorphHost, useMorphHost } from '@lit-core/morph-to-react/runtime';

    window.React = React;
    window.StrictMode = StrictMode;
    window.useState = useState;
    window.useEffect = useEffect;
    window.useRef = useRef;
    window.createRoot = createRoot;
    window.flushSync = flushSync;
    window.CdsButton = CdsButton;
    window.CDSButtonHost = CDSButtonHost;
    window.CdsCheckbox = CdsCheckbox;
    window.CdsCheckboxHost = CdsCheckboxHost;
    window.CdsTabs = CdsTabs;
    window.CdsTabsHost = CdsTabsHost;
    window.CdsTab = CdsTab;
    window.CdsTabHost = CdsTabHost;
    window.MorphHost = MorphHost;
    window.useMorphHost = useMorphHost;
    window.buttonStyles = buttonStyles;
    window.checkboxStyles = checkboxStyles;
    window.tabsStyles = tabsStyles;
    window.__harnessReady = true;
  `;

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
          name: 'Wave1ChallengerBundle',
        },
      },
    },
    plugins: [
      {
        name: 'wave1-challenger-virtual',
        enforce: 'pre',
        resolveId(id) {
          if (id === entryId) return `\0${id}`;
        },
        load(id) {
          if (id === `\0${entryId}`) return entrySource;
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

describe('Milestone 0 Challenger 1 (Verification Wave 1: Empirical Stress Testing)', () => {
  let browser: any;
  let page: any;
  let clientBundleCode: string;

  beforeAll(async () => {
    clientBundleCode = await bundleClientCode();
    browser = await getTestBrowser();
    page = await browser.newPage();
  });

  afterAll(async () => {
    if (page) {
      await page.close();
    }
  });

  beforeEach(async () => {
    await page.setContent(`
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <style>
            body { margin: 0; padding: 20px; font-family: sans-serif; background: #ffffff; }
          </style>
          <script>${clientBundleCode}</script>
        </head>
        <body>
          <div id="test-root"></div>
        </body>
      </html>
    `);
  });

  describe('updateComplete latency and clean resolution (< 50ms)', () => {
    it('verifies single prop change via React rerender resolves updateComplete cleanly in < 50ms', async () => {
      const timingResult = await page.evaluate(async () => {
        const { React, createRoot, CdsButton, StrictMode } = window as any;
        const container = document.getElementById('test-root') as HTMLElement;

        let setButtonKind: (k: string) => void = () => {};
        let hostRefNode: any = null;

        function TestApp() {
          const [kind, setKind] = React.useState('primary');
          setButtonKind = setKind;
          return React.createElement(
            StrictMode,
            null,
            React.createElement(
              CdsButton,
              {
                ref: (node: any) => {
                  hostRefNode = node;
                },
                kind,
              },
              'Latency Test',
            ),
          );
        }

        const root = createRoot(container);
        root.render(React.createElement(TestApp));

        // Wait for initial mount
        await new Promise((r) => setTimeout(r, 40));
        await hostRefNode.updateComplete;

        // Measure prop change updateComplete resolution time
        const start = performance.now();
        setButtonKind('secondary');

        // Await updateComplete with a 500ms safety timeout
        const timeoutPromise = new Promise((resolve) => setTimeout(() => resolve('TIMED_OUT'), 500));
        const raceResult = await Promise.race([hostRefNode.updateComplete.then(() => 'RESOLVED'), timeoutPromise]);
        const elapsed = performance.now() - start;
        const resolvedValue = await hostRefNode.updateComplete;

        root.unmount();

        return {
          raceResult,
          elapsedMs: elapsed,
          resolvedValue,
        };
      });

      expect(timingResult.raceResult).toBe('RESOLVED');
      expect(timingResult.resolvedValue).toBe(true);
      expect(timingResult.elapsedMs).toBeLessThan(50);
    });

    it('stress-tests 50 rapid sequential prop updates with await updateComplete', async () => {
      const stressResult = await page.evaluate(async () => {
        const { React, createRoot, CdsButton, StrictMode } = window as any;
        const container = document.getElementById('test-root') as HTMLElement;

        let setButtonKind: (k: string) => void = () => {};
        let hostRefNode: any = null;

        function TestApp() {
          const [kind, setKind] = React.useState('primary');
          setButtonKind = setKind;
          return React.createElement(
            StrictMode,
            null,
            React.createElement(
              CdsButton,
              {
                ref: (node: any) => {
                  hostRefNode = node;
                },
                kind,
              },
              'Rapid Stress Test',
            ),
          );
        }

        const root = createRoot(container);
        root.render(React.createElement(TestApp));

        await new Promise((r) => setTimeout(r, 40));
        await hostRefNode.updateComplete;

        const kinds = ['primary', 'secondary', 'danger', 'ghost'];
        const latencies: number[] = [];
        let failedCount = 0;

        for (let i = 0; i < 50; i++) {
          const nextKind = kinds[i % kinds.length];
          const t0 = performance.now();
          setButtonKind(nextKind);

          const timeoutPromise = new Promise((resolve) => setTimeout(() => resolve('TIMED_OUT'), 300));
          const raceResult = await Promise.race([hostRefNode.updateComplete.then(() => 'RESOLVED'), timeoutPromise]);
          const dt = performance.now() - t0;

          if (raceResult !== 'RESOLVED' || dt >= 50) {
            failedCount++;
          }
          latencies.push(dt);
        }

        root.unmount();

        const min = Math.min(...latencies);
        const max = Math.max(...latencies);
        const avg = latencies.reduce((a, b) => a + b, 0) / latencies.length;

        return {
          totalUpdates: 50,
          failedCount,
          minMs: min,
          maxMs: max,
          avgMs: avg,
        };
      });

      expect(stressResult.failedCount).toBe(0);
      expect(stressResult.maxMs).toBeLessThan(50);
      expect(stressResult.avgMs).toBeLessThan(20);
    });

    it('verifies direct IDL property mutations resolve updateComplete cleanly in < 50ms', async () => {
      const idlResult = await page.evaluate(async () => {
        const { React, createRoot, CdsButton, StrictMode, flushSync } = window as any;
        const container = document.getElementById('test-root') as HTMLElement;

        let hostRefNode: any = null;
        const root = createRoot(container);

        flushSync(() => {
          root.render(
            React.createElement(
              StrictMode,
              null,
              React.createElement(
                CdsButton,
                {
                  ref: (node: any) => {
                    hostRefNode = node;
                  },
                  kind: 'primary',
                },
                'IDL Test',
              ),
            ),
          );
        });

        await hostRefNode.updateComplete;

        // Perform 20 direct IDL property mutations
        const latencies: number[] = [];
        const kinds = ['secondary', 'danger', 'ghost', 'primary'];

        for (let i = 0; i < 20; i++) {
          const nextKind = kinds[i % kinds.length];
          const t0 = performance.now();
          hostRefNode.kind = nextKind;

          const timeoutPromise = new Promise((resolve) => setTimeout(() => resolve('TIMED_OUT'), 300));
          const res = await Promise.race([hostRefNode.updateComplete.then(() => 'RESOLVED'), timeoutPromise]);
          const dt = performance.now() - t0;

          latencies.push(dt);
          if (res !== 'RESOLVED') {
            throw new Error(`IDL update ${i} deadlocked`);
          }
        }

        root.unmount();

        return {
          maxMs: Math.max(...latencies),
          avgMs: latencies.reduce((a, b) => a + b, 0) / latencies.length,
        };
      });

      expect(idlResult.maxMs).toBeLessThan(50);
    });
  });

  describe('CdsButton dual event firing and click handling', () => {
    it('verifies clicking CdsButton fires both React onClick and native CustomEvent(cds-button-click)', async () => {
      const clickEventsResult = await page.evaluate(() => {
        const { React, createRoot, CdsButton, StrictMode, flushSync } = window as any;
        const container = document.getElementById('test-root') as HTMLElement;

        let hostNode: any = null;
        const root = createRoot(container);

        const logs: { type: string; isCustomEvent: boolean; detail?: any; defaultPrevented: boolean }[] = [];

        let reactOnClickCount = 0;
        let reactOnCdsButtonClickCount = 0;
        let nativeCdsButtonClickCount = 0;
        let nativeClickCount = 0;

        const handleReactClick = (e: any) => {
          reactOnClickCount++;
          logs.push({
            type: 'react-onClick',
            isCustomEvent: false,
            defaultPrevented: e.defaultPrevented,
          });
        };

        const handleReactCdsButtonClick = (e: any) => {
          reactOnCdsButtonClickCount++;
          logs.push({
            type: 'react-onCdsButtonClick',
            isCustomEvent: e instanceof CustomEvent,
            detail: e.detail,
            defaultPrevented: e.defaultPrevented,
          });
        };

        flushSync(() => {
          root.render(
            React.createElement(
              StrictMode,
              null,
              React.createElement(
                CdsButton,
                {
                  ref: (node: any) => {
                    hostNode = node;
                  },
                  onClick: handleReactClick,
                  onCdsButtonClick: handleReactCdsButtonClick,
                },
                'Click Verification',
              ),
            ),
          );
        });

        // Attach native DOM listeners to host <cds-button>
        hostNode.addEventListener('click', (e: MouseEvent) => {
          nativeClickCount++;
          logs.push({
            type: 'native-click',
            isCustomEvent: false,
            defaultPrevented: e.defaultPrevented,
          });
        });

        hostNode.addEventListener('cds-button-click', (e: Event) => {
          nativeCdsButtonClickCount++;
          const ce = e as CustomEvent;
          logs.push({
            type: 'native-cds-button-click',
            isCustomEvent: ce instanceof CustomEvent,
            detail: ce.detail,
            defaultPrevented: ce.defaultPrevented,
          });
        });

        // Click inner button element
        const innerBtn = hostNode.querySelector('button') as HTMLButtonElement;
        innerBtn.click();

        root.unmount();

        return {
          reactOnClickCount,
          reactOnCdsButtonClickCount,
          nativeClickCount,
          nativeCdsButtonClickCount,
          logs,
        };
      });

      expect(clickEventsResult.reactOnClickCount).toBe(1);
      expect(clickEventsResult.nativeClickCount).toBe(1);
      expect(clickEventsResult.reactOnCdsButtonClickCount).toBe(1);
      expect(clickEventsResult.nativeCdsButtonClickCount).toBe(1);

      const cdsEventLog = clickEventsResult.logs.find((l) => l.type === 'native-cds-button-click');
      expect(cdsEventLog).toBeDefined();
      expect(cdsEventLog?.isCustomEvent).toBe(true);
      expect(cdsEventLog?.detail).toHaveProperty('event');
    });

    it('verifies disabled CdsButton suppresses both React onClick and native cds-button-click', async () => {
      const disabledResult = await page.evaluate(() => {
        const { React, createRoot, CdsButton, StrictMode, flushSync } = window as any;
        const container = document.getElementById('test-root') as HTMLElement;

        let hostNode: any = null;
        const root = createRoot(container);

        let reactClickFired = false;
        let nativeCdsClickFired = false;

        flushSync(() => {
          root.render(
            React.createElement(
              StrictMode,
              null,
              React.createElement(
                CdsButton,
                {
                  ref: (node: any) => {
                    hostNode = node;
                  },
                  disabled: true,
                  onClick: () => {
                    reactClickFired = true;
                  },
                  onCdsButtonClick: () => {
                    reactClickFired = true;
                  },
                },
                'Disabled Test',
              ),
            ),
          );
        });

        hostNode.addEventListener('cds-button-click', () => {
          nativeCdsClickFired = true;
        });

        const innerBtn = hostNode.querySelector('button') as HTMLButtonElement;
        innerBtn.click();

        // Also attempt clicking the host element
        hostNode.click();

        root.unmount();

        return {
          reactClickFired,
          nativeCdsClickFired,
        };
      });

      expect(disabledResult.reactClickFired).toBe(false);
      expect(disabledResult.nativeCdsClickFired).toBe(false);
    });

    it('verifies preventDefault in React onClick prevents cds-button-click emission', async () => {
      const preventDefaultResult = await page.evaluate(() => {
        const { React, createRoot, CdsButton, StrictMode, flushSync } = window as any;
        const container = document.getElementById('test-root') as HTMLElement;

        let hostNode: any = null;
        const root = createRoot(container);

        let reactClickFired = false;
        let cdsButtonClickFired = false;

        flushSync(() => {
          root.render(
            React.createElement(
              StrictMode,
              null,
              React.createElement(
                CdsButton,
                {
                  ref: (node: any) => {
                    hostNode = node;
                  },
                  onClick: (e: any) => {
                    reactClickFired = true;
                    e.preventDefault();
                  },
                  onCdsButtonClick: () => {
                    cdsButtonClickFired = true;
                  },
                },
                'Cancel Test',
              ),
            ),
          );
        });

        hostNode.addEventListener('cds-button-click', () => {
          cdsButtonClickFired = true;
        });

        const innerBtn = hostNode.querySelector('button') as HTMLButtonElement;
        innerBtn.click();

        root.unmount();

        return {
          reactClickFired,
          cdsButtonClickFired,
        };
      });

      expect(preventDefaultResult.reactClickFired).toBe(true);
      expect(preventDefaultResult.cdsButtonClickFired).toBe(false);
    });
  });

  describe('CdsTabs bidirectional keyboard navigation without lockup', () => {
    it('verifies keyboard navigation across tabs in both directions without lockup', async () => {
      const navResult = await page.evaluate(async () => {
        const { React, createRoot, CdsTabs, CdsTab, StrictMode, flushSync } = window as any;
        const container = document.getElementById('test-root') as HTMLElement;

        let tabsNode: any = null;
        const root = createRoot(container);

        flushSync(() => {
          root.render(
            React.createElement(
              StrictMode,
              null,
              React.createElement(
                CdsTabs,
                {
                  ref: (node: any) => {
                    tabsNode = node;
                  },
                  defaultValue: 'tab-1',
                },
                React.createElement(CdsTab, { value: 'tab-1' }, 'Tab 1'),
                React.createElement(CdsTab, { value: 'tab-2' }, 'Tab 2'),
                React.createElement(CdsTab, { value: 'tab-3' }, 'Tab 3'),
                React.createElement(CdsTab, { value: 'tab-4' }, 'Tab 4'),
              ),
            ),
          );
        });

        await new Promise((r) => setTimeout(r, 40));

        const tab1Link = tabsNode.querySelector('cds-tab[value="tab-1"] a') as HTMLAnchorElement;
        tab1Link.focus();

        const history: string[] = [];

        function recordState() {
          const selTab = tabsNode.querySelector('cds-tab[selected]') as HTMLElement | null;
          const activeEl = document.activeElement;
          const activeTab = activeEl?.closest('cds-tab') as HTMLElement | null;
          history.push(`sel:${selTab?.getAttribute('value')}|focus:${activeTab?.getAttribute('value')}|tabindex:${activeEl?.getAttribute('tabindex')}`);
        }

        recordState();

        // Step 1: Forward navigation (ArrowRight) from Tab 1 to Tab 2
        tabsNode.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
        await new Promise((r) => setTimeout(r, 40));
        recordState();

        // Step 2: Forward navigation (ArrowRight) from Tab 2 to Tab 3
        tabsNode.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
        await new Promise((r) => setTimeout(r, 40));
        recordState();

        // Step 3: Forward navigation (ArrowRight) from Tab 3 to Tab 4
        tabsNode.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
        await new Promise((r) => setTimeout(r, 40));
        recordState();

        // Step 4: Wrap-around forward (ArrowRight) from Tab 4 back to Tab 1
        tabsNode.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
        await new Promise((r) => setTimeout(r, 40));
        recordState();

        // Step 5: Wrap-around backward (ArrowLeft) from Tab 1 to Tab 4
        tabsNode.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }));
        await new Promise((r) => setTimeout(r, 40));
        recordState();

        // Step 6: Backward navigation (ArrowLeft) from Tab 4 to Tab 3
        tabsNode.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }));
        await new Promise((r) => setTimeout(r, 40));
        recordState();

        // Step 7: Home key jump to Tab 1
        tabsNode.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true, cancelable: true }));
        await new Promise((r) => setTimeout(r, 40));
        recordState();

        // Step 8: End key jump to Tab 4
        tabsNode.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true }));
        await new Promise((r) => setTimeout(r, 40));
        recordState();

        root.unmount();

        return { history };
      });

      expect(navResult.history).toEqual([
        'sel:tab-1|focus:tab-1|tabindex:0',
        'sel:tab-2|focus:tab-2|tabindex:0',
        'sel:tab-3|focus:tab-3|tabindex:0',
        'sel:tab-4|focus:tab-4|tabindex:0',
        'sel:tab-1|focus:tab-1|tabindex:0',
        'sel:tab-4|focus:tab-4|tabindex:0',
        'sel:tab-3|focus:tab-3|tabindex:0',
        'sel:tab-1|focus:tab-1|tabindex:0',
        'sel:tab-4|focus:tab-4|tabindex:0',
      ]);
    });

    it('stress-tests 100 rapid alternating keypresses without lockup or desync', async () => {
      const rapidResult = await page.evaluate(async () => {
        const { React, createRoot, CdsTabs, CdsTab, StrictMode, flushSync } = window as any;
        const container = document.getElementById('test-root') as HTMLElement;

        let tabsNode: any = null;
        const root = createRoot(container);

        flushSync(() => {
          root.render(
            React.createElement(
              StrictMode,
              null,
              React.createElement(
                CdsTabs,
                {
                  ref: (node: any) => {
                    tabsNode = node;
                  },
                  defaultValue: 'tab-1',
                },
                React.createElement(CdsTab, { value: 'tab-1' }, 'Tab 1'),
                React.createElement(CdsTab, { value: 'tab-2' }, 'Tab 2'),
                React.createElement(CdsTab, { value: 'tab-3' }, 'Tab 3'),
              ),
            ),
          );
        });

        await new Promise((r) => setTimeout(r, 40));

        const tab1Link = tabsNode.querySelector('cds-tab[value="tab-1"] a') as HTMLAnchorElement;
        tab1Link.focus();

        const keys = ['ArrowRight', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowLeft'];
        for (let i = 0; i < 100; i++) {
          const k = keys[i % keys.length];
          tabsNode.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
          if (i % 10 === 0) {
            await new Promise((r) => setTimeout(r, 10));
          }
        }

        await new Promise((r) => setTimeout(r, 50));

        const selTab = tabsNode.querySelector('cds-tab[selected]') as HTMLElement | null;
        const activeEl = document.activeElement;
        const activeTab = activeEl?.closest('cds-tab') as HTMLElement | null;

        root.unmount();

        return {
          finalSelected: selTab?.getAttribute('value'),
          finalFocused: activeTab?.getAttribute('value'),
          tabIndex: activeEl?.getAttribute('tabindex'),
        };
      });

      expect(rapidResult.finalSelected).toBeDefined();
      expect(rapidResult.finalSelected).toBe(rapidResult.finalFocused);
      expect(rapidResult.tabIndex).toBe('0');
    });

    it('verifies keyboard navigation smoothly skips disabled tabs in both directions', async () => {
      const skipResult = await page.evaluate(async () => {
        const { React, createRoot, CdsTabs, CdsTab, StrictMode, flushSync } = window as any;
        const container = document.getElementById('test-root') as HTMLElement;

        let tabsNode: any = null;
        const root = createRoot(container);

        flushSync(() => {
          root.render(
            React.createElement(
              StrictMode,
              null,
              React.createElement(
                CdsTabs,
                {
                  ref: (node: any) => {
                    tabsNode = node;
                  },
                  defaultValue: 'tab-1',
                },
                React.createElement(CdsTab, { value: 'tab-1' }, 'Tab 1'),
                React.createElement(CdsTab, { value: 'tab-2', disabled: true }, 'Tab 2 (Disabled)'),
                React.createElement(CdsTab, { value: 'tab-3' }, 'Tab 3'),
              ),
            ),
          );
        });

        await new Promise((r) => setTimeout(r, 40));

        const tab1Link = tabsNode.querySelector('cds-tab[value="tab-1"] a') as HTMLAnchorElement;
        tab1Link.focus();

        // ArrowRight from Tab 1 should skip disabled Tab 2 and land on Tab 3
        tabsNode.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
        await new Promise((r) => setTimeout(r, 40));
        const afterForward = (tabsNode.querySelector('cds-tab[selected]') as HTMLElement)?.getAttribute('value');

        // ArrowLeft from Tab 3 should skip disabled Tab 2 and land back on Tab 1
        tabsNode.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }));
        await new Promise((r) => setTimeout(r, 40));
        const afterBackward = (tabsNode.querySelector('cds-tab[selected]') as HTMLElement)?.getAttribute('value');

        root.unmount();

        return {
          afterForward,
          afterBackward,
        };
      });

      expect(skipResult.afterForward).toBe('tab-3');
      expect(skipResult.afterBackward).toBe('tab-1');
    });

    it('verifies controlled CdsTabs navigation coordinates with parent state without lockup', async () => {
      const controlledResult = await page.evaluate(async () => {
        const { React, createRoot, CdsTabs, CdsTab, StrictMode } = window as any;
        const container = document.getElementById('test-root') as HTMLElement;

        let tabsNode: any = null;

        function ControlledApp() {
          const [activeTab, setActiveTab] = React.useState('tab-1');
          return React.createElement(
            StrictMode,
            null,
            React.createElement(
              CdsTabs,
              {
                ref: (node: any) => {
                  tabsNode = node;
                },
                value: activeTab,
                onCdsTabsSelected: (e: any) => {
                  setActiveTab(e.detail.name || e.detail.item?.getAttribute('value'));
                },
              },
              React.createElement(CdsTab, { value: 'tab-1' }, 'Tab 1'),
              React.createElement(CdsTab, { value: 'tab-2' }, 'Tab 2'),
              React.createElement(CdsTab, { value: 'tab-3' }, 'Tab 3'),
            ),
          );
        }

        const root = createRoot(container);
        root.render(React.createElement(ControlledApp));

        await new Promise((r) => setTimeout(r, 40));

        const tab1Link = tabsNode.querySelector('cds-tab[value="tab-1"] a') as HTMLAnchorElement;
        tab1Link.focus();

        // ArrowRight: triggers onCdsTabsSelected -> parent updates activeTab -> re-renders with value='tab-2'
        tabsNode.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
        await new Promise((r) => setTimeout(r, 40));

        const selTabAfterRight = (tabsNode.querySelector('cds-tab[selected]') as HTMLElement)?.getAttribute('value');

        // ArrowRight again -> re-renders with value='tab-3'
        tabsNode.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
        await new Promise((r) => setTimeout(r, 40));

        const selTabAfterSecondRight = (tabsNode.querySelector('cds-tab[selected]') as HTMLElement)?.getAttribute('value');

        root.unmount();

        return {
          selTabAfterRight,
          selTabAfterSecondRight,
        };
      });

      expect(controlledResult.selTabAfterRight).toBe('tab-2');
      expect(controlledResult.selTabAfterSecondRight).toBe('tab-3');
    });
  });
});
