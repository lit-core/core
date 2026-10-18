import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CdsButton, CdsCheckbox, CdsTab, CdsTabs } from '@lit-core/morph-to-react/carbon';
import React, { StrictMode } from 'react';
import { renderToString } from 'react-dom/server';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getTestBrowser } from '../harness.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../../../..');

describe('Milestone 0 Challenger 2 empirical verification', () => {
  let browser: any;
  let page: any;
  let clientBundleCode: string;

  beforeAll(async () => {
    // 1. Bundle React 19 client runtime and components with Vite for browser execution
    const entryId = 'virtual:challenger-client-entry.js';
    const entrySource = `
      import React, { StrictMode, createRef } from 'react';
      import { createRoot, hydrateRoot } from 'react-dom/client';
      import { flushSync } from 'react-dom';
      import {
        CdsButton,
        CdsCheckbox,
        CdsTabs,
        CdsTab,
        buttonStyles,
        checkboxStyles,
        tabsStyles,
      } from '@lit-core/morph-to-react/carbon';

      window.React = React;
      window.StrictMode = StrictMode;
      window.createRef = createRef;
      window.createRoot = createRoot;
      window.hydrateRoot = hydrateRoot;
      window.flushSync = flushSync;
      window.CdsButton = CdsButton;
      window.CdsCheckbox = CdsCheckbox;
      window.CdsTabs = CdsTabs;
      window.CdsTab = CdsTab;
      window.buttonStyles = buttonStyles;
      window.checkboxStyles = checkboxStyles;
      window.tabsStyles = tabsStyles;
      window.__clientReady = true;
    `;

    const buildResult = await build({
      logLevel: 'silent',
      configFile: false,
      root: rootDir,
      build: {
        write: false,
        minify: false,
        rollupOptions: {
          input: entryId,
          output: {
            format: 'iife',
            name: 'ChallengerBundle',
          },
        },
      },
      plugins: [
        {
          name: 'challenger-virtual-entry',
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

    const rawOutput = (buildResult as any).output || (Array.isArray(buildResult) ? buildResult[0].output : []);
    const jsChunk = rawOutput.find((c: any) => c.fileName?.endsWith('.js'));
    if (!jsChunk || !('code' in jsChunk)) {
      throw new Error('Failed to produce client bundle code');
    }
    clientBundleCode = jsChunk.code;

    // 2. Launch Chromium via shared test browser
    browser = await getTestBrowser();
    page = await browser.newPage();
    await page.setContent(`
      <!DOCTYPE html>
      <html>
        <head><meta charset="utf-8"></head>
        <body>
          <div id="test-container"></div>
          <script>${clientBundleCode}</script>
        </body>
      </html>
    `);

    await page.waitForFunction(() => (window as any).__clientReady === true, { timeout: 10000 });
  });

  afterAll(async () => {
    if (page) {
      await page.close();
    }
  });

  // =========================================================================
  // REQUIREMENT 1: REACT 19 SSR RENDERTOSTRING + HYDRATION IN STRICTMODE
  // =========================================================================
  describe('React 19 SSR renderToString + hydrateRoot in <StrictMode>', () => {
    it('hydrates CdsButton across diverse variants with zero console warnings', async () => {
      const buttonScenarios = [
        { props: { kind: 'primary' }, children: 'Primary Button' },
        { props: { kind: 'secondary', size: 'sm' }, children: 'Small Secondary' },
        { props: { kind: 'danger', size: '2xl' }, children: 'Danger Large' },
        { props: { kind: 'ghost', isSelected: true }, children: 'Ghost Selected' },
        { props: { disabled: true }, children: 'Disabled Button' },
        { props: { href: 'https://example.com', target: '_blank' }, children: 'Link Button' },
        { props: { dangerDescription: 'Delete all records' }, children: 'Danger With Description' },
        { props: { tooltipText: 'Help text', tooltipPosition: 'bottom' as const }, children: 'With Tooltip' },
        {
          props: { kind: 'primary' },
          children: null,
          hasSlots: true,
          iconNode: React.createElement('svg', { slot: 'icon', viewBox: '0 0 16 16', id: 'svg-icon' }, React.createElement('circle', { cx: 8, cy: 8, r: 4 })),
          badgeNode: React.createElement('span', { slot: 'badge-indicator', id: 'badge-ind' }, '99'),
          label: 'Slotted Content',
        },
      ];

      for (const scenario of buttonScenarios) {
        let element: React.ReactElement;
        if (scenario.hasSlots) {
          element = React.createElement(StrictMode, null, React.createElement(CdsButton, scenario.props, scenario.iconNode, scenario.badgeNode, scenario.label));
        } else {
          element = React.createElement(StrictMode, null, React.createElement(CdsButton, scenario.props, scenario.children));
        }

        const ssrHtml = renderToString(element);
        expect(ssrHtml).toContain('cds-button');

        // Execute real hydrateRoot in Chromium with console error/warning interception
        const hydrationResult = await page.evaluate(
          ({ html, scenarioProps, scenarioChildren, hasSlots }: any) => {
            const container = document.createElement('div');
            document.body.appendChild(container);
            container.innerHTML = html;

            const capturedLogs: string[] = [];
            const originalError = console.error;
            const originalWarn = console.warn;
            console.error = (...args) => capturedLogs.push(`[error] ${args.join(' ')}`);
            console.warn = (...args) => capturedLogs.push(`[warn] ${args.join(' ')}`);

            let root: any;
            try {
              const React = (window as any).React;
              const StrictMode = (window as any).StrictMode;
              const CdsButton = (window as any).CdsButton;
              const hydrateRoot = (window as any).hydrateRoot;

              let clientElement: any;
              if (hasSlots) {
                clientElement = React.createElement(
                  StrictMode,
                  null,
                  React.createElement(
                    CdsButton,
                    scenarioProps,
                    React.createElement('svg', { slot: 'icon', viewBox: '0 0 16 16', id: 'svg-icon' }, React.createElement('circle', { cx: 8, cy: 8, r: 4 })),
                    React.createElement('span', { slot: 'badge-indicator', id: 'badge-ind' }, '99'),
                    'Slotted Content',
                  ),
                );
              } else {
                clientElement = React.createElement(StrictMode, null, React.createElement(CdsButton, scenarioProps, scenarioChildren));
              }

              root = hydrateRoot(container, clientElement);
            } catch (err: any) {
              capturedLogs.push(`[exception] ${err.stack || err.message}`);
            } finally {
              console.error = originalError;
              console.warn = originalWarn;
            }

            const buttonEl = container.querySelector('cds-button');
            const innerBtn = container.querySelector('button, a, p');
            const textContent = innerBtn?.textContent?.trim() || '';

            try {
              root?.unmount();
            } catch {}
            container.remove();

            return {
              logs: capturedLogs,
              hasHost: Boolean(buttonEl),
              hasInner: Boolean(innerBtn),
              textContent,
            };
          },
          {
            html: ssrHtml,
            scenarioProps: scenario.props,
            scenarioChildren: scenario.children,
            hasSlots: scenario.hasSlots || false,
          },
        );

        // Check for hydration warnings or errors
        const hydrationWarnings = hydrationResult.logs.filter(
          (l: string) => l.toLowerCase().includes('hydration') || l.toLowerCase().includes('did not match') || l.toLowerCase().includes('mismatch') || l.toLowerCase().includes('error'),
        );

        expect(hydrationWarnings).toEqual([]);
        expect(hydrationResult.hasHost).toBe(true);
        expect(hydrationResult.hasInner).toBe(true);
      }
    });

    it('hydrates CdsCheckbox across diverse variants with zero console warnings', async () => {
      const checkboxScenarios = [
        { props: { labelText: 'Standard checkbox' } },
        { props: { checked: true, labelText: 'Checked checkbox' } },
        { props: { defaultChecked: true, labelText: 'Default checked' } },
        { props: { indeterminate: true, labelText: 'Indeterminate state' } },
        { props: { disabled: true, labelText: 'Disabled checkbox' } },
        { props: { readonly: true, labelText: 'Readonly checkbox' } },
        { props: { invalid: true, invalidText: 'Must agree to terms', labelText: 'Invalid state' } },
        { props: { warn: true, warnText: 'Proceed with caution', labelText: 'Warning state' } },
        { props: { helperText: 'Helper guidance', labelText: 'With helper' } },
        { props: { hideLabel: true, labelText: 'Visually hidden label' } },
        { props: { id: 'explicit-checkbox-id', labelText: 'Explicit ID' } },
        {
          props: { labelText: 'With AI Label' },
          aiLabel: React.createElement('span', { slot: 'ai-label', id: 'ai-l' }, 'AI Tag'),
        },
      ];

      for (const scenario of checkboxScenarios) {
        const element = React.createElement(StrictMode, null, React.createElement(CdsCheckbox, scenario.props, scenario.aiLabel || null));

        const ssrHtml = renderToString(element);
        expect(ssrHtml).toContain('cds-checkbox');

        const hydrationResult = await page.evaluate(
          ({ html, scenarioProps, hasAiLabel }: any) => {
            const container = document.createElement('div');
            document.body.appendChild(container);
            container.innerHTML = html;

            const capturedLogs: string[] = [];
            const originalError = console.error;
            const originalWarn = console.warn;
            console.error = (...args) => capturedLogs.push(`[error] ${args.join(' ')}`);
            console.warn = (...args) => capturedLogs.push(`[warn] ${args.join(' ')}`);

            let root: any;
            try {
              const React = (window as any).React;
              const StrictMode = (window as any).StrictMode;
              const CdsCheckbox = (window as any).CdsCheckbox;
              const hydrateRoot = (window as any).hydrateRoot;

              const aiLabelNode = hasAiLabel ? React.createElement('span', { slot: 'ai-label', id: 'ai-l' }, 'AI Tag') : null;

              const clientElement = React.createElement(StrictMode, null, React.createElement(CdsCheckbox, scenarioProps, aiLabelNode));

              root = hydrateRoot(container, clientElement);
            } catch (err: any) {
              capturedLogs.push(`[exception] ${err.stack || err.message}`);
            } finally {
              console.error = originalError;
              console.warn = originalWarn;
            }

            const chkEl = container.querySelector('cds-checkbox');
            const inputEl = container.querySelector('input[type="checkbox"]') as HTMLInputElement;

            try {
              root?.unmount();
            } catch {}
            container.remove();

            return {
              logs: capturedLogs,
              hasHost: Boolean(chkEl),
              hasInput: Boolean(inputEl),
            };
          },
          {
            html: ssrHtml,
            scenarioProps: scenario.props,
            hasAiLabel: Boolean(scenario.aiLabel),
          },
        );

        const hydrationWarnings = hydrationResult.logs.filter(
          (l: string) => l.toLowerCase().includes('hydration') || l.toLowerCase().includes('did not match') || l.toLowerCase().includes('mismatch') || l.toLowerCase().includes('error'),
        );

        expect(hydrationWarnings).toEqual([]);
        expect(hydrationResult.hasHost).toBe(true);
        expect(hydrationResult.hasInput).toBe(true);
      }
    });

    it('hydrates CdsTabs composite with slot boundary and child tabs without warnings', async () => {
      const tabsElement = React.createElement(
        StrictMode,
        null,
        React.createElement(
          CdsTabs,
          { value: 'tab-settings', size: 'lg' },
          React.createElement(CdsTab, { value: 'tab-overview' }, 'Overview'),
          React.createElement(CdsTab, { value: 'tab-settings' }, 'Settings'),
          React.createElement(CdsTab, { value: 'tab-audit', disabled: true }, 'Audit Log'),
        ),
      );

      const ssrHtml = renderToString(tabsElement);
      expect(ssrHtml).toContain('cds-tabs');
      expect(ssrHtml).toContain('slot-boundary');

      const hydrationResult = await page.evaluate(
        ({ html }: { html: string }) => {
          const container = document.createElement('div');
          document.body.appendChild(container);
          container.innerHTML = html;

          const capturedLogs: string[] = [];
          const originalError = console.error;
          const originalWarn = console.warn;
          console.error = (...args) => capturedLogs.push(`[error] ${args.join(' ')}`);
          console.warn = (...args) => capturedLogs.push(`[warn] ${args.join(' ')}`);

          let root: any;
          try {
            const React = (window as any).React;
            const StrictMode = (window as any).StrictMode;
            const CdsTabs = (window as any).CdsTabs;
            const CdsTab = (window as any).CdsTab;
            const hydrateRoot = (window as any).hydrateRoot;

            const clientElement = React.createElement(
              StrictMode,
              null,
              React.createElement(
                CdsTabs,
                { value: 'tab-settings', size: 'lg' },
                React.createElement(CdsTab, { value: 'tab-overview' }, 'Overview'),
                React.createElement(CdsTab, { value: 'tab-settings' }, 'Settings'),
                React.createElement(CdsTab, { value: 'tab-audit', disabled: true }, 'Audit Log'),
              ),
            );

            root = hydrateRoot(container, clientElement);
          } catch (err: any) {
            capturedLogs.push(`[exception] ${err.stack || err.message}`);
          } finally {
            console.error = originalError;
            console.warn = originalWarn;
          }

          const tabsEl = container.querySelector('cds-tabs');
          const tabNodes = container.querySelectorAll('cds-tab');
          const boundary = container.querySelector('slot-boundary');

          try {
            root?.unmount();
          } catch {}
          container.remove();

          return {
            logs: capturedLogs,
            hasTabs: Boolean(tabsEl),
            tabCount: tabNodes.length,
            hasBoundary: Boolean(boundary),
          };
        },
        { html: ssrHtml },
      );

      const hydrationWarnings = hydrationResult.logs.filter(
        (l: string) => l.toLowerCase().includes('hydration') || l.toLowerCase().includes('did not match') || l.toLowerCase().includes('mismatch') || l.toLowerCase().includes('error'),
      );

      expect(hydrationWarnings).toEqual([]);
      expect(hydrationResult.hasTabs).toBe(true);
      expect(hydrationResult.tabCount).toBe(3);
      expect(hydrationResult.hasBoundary).toBe(true);
    });
  });

  // =========================================================================
  // REQUIREMENT 2: DOM FACADE METHODS FORWARDING ON REF.CURRENT
  // =========================================================================
  describe('DOM facade methods (focus, blur, getAttribute, setAttribute) on ref.current', () => {
    it('executes focus, blur, getAttribute, setAttribute, removeAttribute on CdsButton ref', async () => {
      const refResult = await page.evaluate(() => {
        const container = document.createElement('div');
        document.body.appendChild(container);

        const React = (window as any).React;
        const StrictMode = (window as any).StrictMode;
        const CdsButton = (window as any).CdsButton;
        const createRoot = (window as any).createRoot;
        const createRef = (window as any).createRef;
        const flushSync = (window as any).flushSync;

        const buttonRef = createRef();
        const root = createRoot(container);

        flushSync(() => {
          root.render(React.createElement(StrictMode, null, React.createElement(CdsButton, { ref: buttonRef, kind: 'primary', id: 'ref-btn' }, 'Ref Target')));
        });

        const btnNode = buttonRef.current as HTMLElement;
        if (!btnNode) {
          root.unmount();
          container.remove();
          return { error: 'Ref was null after render' };
        }

        const tag = btnNode.tagName.toLowerCase();
        const isHostElement = tag === 'cds-button';

        // 1. Test getAttribute
        const initialKind = btnNode.getAttribute('kind');

        // 2. Test setAttribute
        btnNode.setAttribute('data-tested', 'true');
        const setAttrVal = btnNode.getAttribute('data-tested');

        // 3. Test hasAttribute and removeAttribute
        const hadAttr = btnNode.hasAttribute('data-tested');
        btnNode.removeAttribute('data-tested');
        const hasAfterRemove = btnNode.hasAttribute('data-tested');

        // 4. Test focus and blur execution without throwing
        let focusedTargetTag = '';
        let focusSucceeded = false;
        let blurSucceeded = false;

        try {
          btnNode.focus();
          focusedTargetTag = document.activeElement?.tagName.toLowerCase() || '';
          focusSucceeded = true;
        } catch (err: any) {
          root.unmount();
          container.remove();
          return { error: `focus threw: ${err.message}` };
        }

        try {
          btnNode.blur();
          blurSucceeded = true;
        } catch (err: any) {
          root.unmount();
          container.remove();
          return { error: `blur threw: ${err.message}` };
        }

        root.unmount();
        container.remove();

        return {
          isHostElement,
          initialKind,
          setAttrVal,
          hadAttr,
          hasAfterRemove,
          focusedTargetTag,
          focusSucceeded,
          blurSucceeded,
        };
      });

      expect(refResult.error).toBeUndefined();
      expect(refResult.isHostElement).toBe(true);
      expect(refResult.initialKind).toBe('primary');
      expect(refResult.setAttrVal).toBe('true');
      expect(refResult.hadAttr).toBe(true);
      expect(refResult.hasAfterRemove).toBe(false);
      expect(refResult.focusSucceeded).toBe(true);
      expect(refResult.blurSucceeded).toBe(true);
      // Focus delegates to inner button as documented in CdsButtonHost
      expect(refResult.focusedTargetTag).toBe('button');
    });

    it('executes focus, blur, and property getters/setters on CdsCheckbox ref', async () => {
      const refResult = await page.evaluate(() => {
        const container = document.createElement('div');
        document.body.appendChild(container);

        const React = (window as any).React;
        const StrictMode = (window as any).StrictMode;
        const CdsCheckbox = (window as any).CdsCheckbox;
        const createRoot = (window as any).createRoot;
        const createRef = (window as any).createRef;
        const flushSync = (window as any).flushSync;

        const checkRef = createRef();
        const root = createRoot(container);

        flushSync(() => {
          root.render(React.createElement(StrictMode, null, React.createElement(CdsCheckbox, { ref: checkRef, labelText: 'Ref Checkbox' })));
        });

        const hostNode = checkRef.current as any;
        if (!hostNode) {
          root.unmount();
          container.remove();
          return { error: 'Checkbox ref was null' };
        }

        const tag = hostNode.tagName.toLowerCase();

        // Attribute methods
        hostNode.setAttribute('title', 'Ref Title');
        const titleVal = hostNode.getAttribute('title');

        // Focus and blur delegation to inner input
        let focusTarget = '';
        try {
          hostNode.focus();
          focusTarget = document.activeElement?.tagName.toLowerCase() || '';
          hostNode.blur();
        } catch (err: any) {
          root.unmount();
          container.remove();
          return { error: `focus/blur threw: ${err.message}` };
        }

        // Own property setters on ref
        const initialChecked = hostNode.checked;
        hostNode.checked = true;
        const checkedAfterSet = hostNode.checked;

        const initialIndet = hostNode.indeterminate;
        hostNode.indeterminate = true;
        const indetAfterSet = hostNode.indeterminate;

        root.unmount();
        container.remove();

        return {
          tag,
          titleVal,
          focusTarget,
          initialChecked,
          checkedAfterSet,
          initialIndet,
          indetAfterSet,
        };
      });

      expect(refResult.error).toBeUndefined();
      expect(refResult.tag).toBe('cds-checkbox');
      expect(refResult.titleVal).toBe('Ref Title');
      expect(refResult.focusTarget).toBe('input');
      expect(refResult.initialChecked).toBe(false);
      expect(refResult.checkedAfterSet).toBe(true);
      expect(refResult.initialIndet).toBe(false);
      expect(refResult.indetAfterSet).toBe(true);
    });
  });

  // =========================================================================
  // REQUIREMENT 3: HOSTILE PAGE-LEVEL STYLES BEHAVIOR
  // =========================================================================
  describe('Hostile page-level styles and layout token preservation', () => {
    it('preserves core layout tokens and prevents catastrophic geometry deformation under aggressive global CSS', async () => {
      const hostileResult = await page.evaluate(() => {
        const container = document.createElement('div');
        document.body.appendChild(container);

        const React = (window as any).React;
        const StrictMode = (window as any).StrictMode;
        const CdsButton = (window as any).CdsButton;
        const CdsCheckbox = (window as any).CdsCheckbox;
        const CdsTabs = (window as any).CdsTabs;
        const CdsTab = (window as any).CdsTab;
        const createRoot = (window as any).createRoot;
        const flushSync = (window as any).flushSync;

        // Render button, checkbox, and tabs
        const root = createRoot(container);
        flushSync(() => {
          root.render(
            React.createElement(
              StrictMode,
              null,
              React.createElement(
                'div',
                { id: 'app-surface' },
                React.createElement(CdsButton, { kind: 'primary', id: 'target-btn' }, 'Target Button'),
                React.createElement(CdsCheckbox, { id: 'target-chk', labelText: 'Target Checkbox' }),
                React.createElement(
                  CdsTabs,
                  { id: 'target-tabs', value: 'tab-1', size: 'lg' },
                  React.createElement(CdsTab, { value: 'tab-1' }, 'Tab 1'),
                  React.createElement(CdsTab, { value: 'tab-2' }, 'Tab 2'),
                ),
              ),
            ),
          );
        });

        const btnEl = container.querySelector('cds-button') as HTMLElement;
        const chkEl = container.querySelector('cds-checkbox') as HTMLElement;
        const tabsEl = container.querySelector('cds-tabs') as HTMLElement;

        // Measure baseline geometry
        const baseBtnRect = btnEl.getBoundingClientRect();
        const baseChkRect = chkEl.getBoundingClientRect();
        const baseTabsRect = tabsEl.getBoundingClientRect();

        // Inject hostile page stylesheet with aggressive resets and overrides
        const hostileStyle = document.createElement('style');
        hostileStyle.id = 'hostile-css';
        hostileStyle.textContent = `
          * {
            box-sizing: content-box !important;
            line-height: 3 !important;
          }
          button {
            margin: 32px !important;
            padding: 18px !important;
            font-size: 28px !important;
            border: 5px solid red !important;
          }
          input[type="checkbox"] {
            width: 50px !important;
            height: 50px !important;
            margin: 20px !important;
          }
          a {
            text-decoration: underline wavy green !important;
            padding: 10px !important;
          }
        `;
        document.head.appendChild(hostileStyle);

        // Measure hostile geometry
        const hostileBtnRect = btnEl.getBoundingClientRect();
        const hostileChkRect = chkEl.getBoundingClientRect();
        const hostileTabsRect = tabsEl.getBoundingClientRect();

        // Check if layout custom properties are preserved
        const tabEl = tabsEl.querySelector('cds-tab') as HTMLElement;
        const layoutSizeHeight = tabEl?.style.getPropertyValue('--cds-layout-size-height');

        // Check button host display
        const btnDisplay = window.getComputedStyle(btnEl).display;

        // Clean up
        hostileStyle.remove();
        root.unmount();
        container.remove();

        return {
          btnDisplay,
          layoutSizeHeight,
          baseBtnRect: { w: baseBtnRect.width, h: baseBtnRect.height },
          hostileBtnRect: { w: hostileBtnRect.width, h: hostileBtnRect.height },
          baseChkRect: { w: baseChkRect.width, h: baseChkRect.height },
          hostileChkRect: { w: hostileChkRect.width, h: hostileChkRect.height },
          baseTabsRect: { w: baseTabsRect.width, h: baseTabsRect.height },
          hostileTabsRect: { w: hostileTabsRect.width, h: hostileTabsRect.height },
        };
      });

      // 1. Host display is preserved as inline-flex
      expect(hostileResult.btnDisplay).toBe('inline-flex');

      // 2. Child tab sizing custom properties set by MutationObserver are preserved
      expect(hostileResult.layoutSizeHeight).toBe('var(--cds-layout-size-height-lg)');

      // 3. Components did not collapse catastrophically to 0 dimensions
      expect(hostileResult.hostileBtnRect.w).toBeGreaterThan(0);
      expect(hostileResult.hostileBtnRect.h).toBeGreaterThan(0);
      expect(hostileResult.hostileChkRect.w).toBeGreaterThan(0);
      expect(hostileResult.hostileChkRect.h).toBeGreaterThan(0);
      expect(hostileResult.hostileTabsRect.w).toBeGreaterThan(0);
      expect(hostileResult.hostileTabsRect.h).toBeGreaterThan(0);

      // 4. Verify that light DOM gap is observable (button dimensions changed due to external button selector)
      // This confirms our test is actually testing real light DOM CSS leakage
      expect(hostileResult.hostileBtnRect.h).toBeGreaterThan(hostileResult.baseBtnRect.h);
    });

    it('documents CdsButton attribute forwarding gap: id and className are not passed to <cds-button>', async () => {
      const attrResult = await page.evaluate(() => {
        const container = document.createElement('div');
        document.body.appendChild(container);

        const React = (window as any).React;
        const StrictMode = (window as any).StrictMode;
        const CdsButton = (window as any).CdsButton;
        const createRoot = (window as any).createRoot;
        const createRef = (window as any).createRef;
        const flushSync = (window as any).flushSync;

        const buttonRef = createRef();
        const root = createRoot(container);

        flushSync(() => {
          root.render(React.createElement(StrictMode, null, React.createElement(CdsButton, { ref: buttonRef, id: 'custom-btn-id', className: 'custom-class' }, 'Test')));
        });

        const hostEl = buttonRef.current as HTMLElement;
        const hostId = hostEl.getAttribute('id');
        const hostClass = hostEl.getAttribute('class');

        root.unmount();
        container.remove();

        return {
          hostId,
          hostClass,
        };
      });

      // CdsButton forwards id and className to <cds-button>
      expect(attrResult.hostId).toBe('custom-btn-id');
      expect(attrResult.hostClass).toBe('custom-class');
    });
  });

  // =========================================================================
  // ADDITIONAL STRESS TESTS: COMPLEX SLOTS, REMOUNT, UPDATECOMPLETE
  // =========================================================================
  describe('Additional stress tests: complex slots, remount, updateComplete', () => {
    it('hydrates complex dynamic, null, and fragment slot children without warnings', async () => {
      const complexScenarios = [
        { name: 'empty', children: null },
        {
          name: 'mixed',
          children: ['Prefix ', React.createElement('strong', { key: 's' }, 'Bold'), ' Suffix'],
        },
        {
          name: 'multiple-slots',
          children: [React.createElement('span', { slot: 'icon', key: 'i' }, '★'), React.createElement('span', { slot: 'badge-indicator', key: 'b' }, '●'), 'Content'],
        },
        {
          name: 'fragment',
          children: React.createElement(React.Fragment, null, React.createElement('span', { slot: 'icon' }, 'Icon'), 'Fragment Label'),
        },
      ];

      for (const scenario of complexScenarios) {
        const element = React.createElement(StrictMode, null, React.createElement(CdsButton, { kind: 'primary' }, scenario.children));

        const ssrHtml = renderToString(element);

        const hydrationResult = await page.evaluate(
          ({ html, scenarioName }: any) => {
            const container = document.createElement('div');
            document.body.appendChild(container);
            container.innerHTML = html;

            const capturedLogs: string[] = [];
            const originalError = console.error;
            const originalWarn = console.warn;
            console.error = (...args) => capturedLogs.push(`[error] ${args.join(' ')}`);
            console.warn = (...args) => capturedLogs.push(`[warn] ${args.join(' ')}`);

            let root: any;
            try {
              const React = (window as any).React;
              const StrictMode = (window as any).StrictMode;
              const CdsButton = (window as any).CdsButton;
              const hydrateRoot = (window as any).hydrateRoot;

              let children: any = null;
              if (scenarioName === 'empty') {
                children = null;
              } else if (scenarioName === 'mixed') {
                children = ['Prefix ', React.createElement('strong', { key: 's' }, 'Bold'), ' Suffix'];
              } else if (scenarioName === 'multiple-slots') {
                children = [React.createElement('span', { slot: 'icon', key: 'i' }, '★'), React.createElement('span', { slot: 'badge-indicator', key: 'b' }, '●'), 'Content'];
              } else if (scenarioName === 'fragment') {
                children = React.createElement(React.Fragment, null, React.createElement('span', { slot: 'icon' }, 'Icon'), 'Fragment Label');
              }

              const clientElement = React.createElement(StrictMode, null, React.createElement(CdsButton, { kind: 'primary' }, children));

              root = hydrateRoot(container, clientElement);
            } catch (err: any) {
              capturedLogs.push(`[exception] ${err.stack || err.message}`);
            } finally {
              console.error = originalError;
              console.warn = originalWarn;
            }

            try {
              root?.unmount();
            } catch {}
            container.remove();

            return { logs: capturedLogs };
          },
          { html: ssrHtml, scenarioName: scenario.name },
        );

        const hydrationWarnings = hydrationResult.logs.filter(
          (l: string) => l.toLowerCase().includes('hydration') || l.toLowerCase().includes('did not match') || l.toLowerCase().includes('mismatch') || l.toLowerCase().includes('error'),
        );

        expect(hydrationWarnings).toEqual([]);
      }
    });

    it('documents updateComplete deadlock bug on property mutation due to static [host] useLayoutEffect dependency', async () => {
      const updateResult = await page.evaluate(async () => {
        const container = document.createElement('div');
        document.body.appendChild(container);

        const React = (window as any).React;
        const StrictMode = (window as any).StrictMode;
        const CdsButton = (window as any).CdsButton;
        const createRoot = (window as any).createRoot;
        const createRef = (window as any).createRef;
        const flushSync = (window as any).flushSync;

        const buttonRef = createRef();
        const root = createRoot(container);

        flushSync(() => {
          root.render(React.createElement(StrictMode, null, React.createElement(CdsButton, { ref: buttonRef, kind: 'primary' }, 'Update Test')));
        });

        const btnNode = buttonRef.current as any;
        const initialComplete = await btnNode.updateComplete;

        // Mutation triggers requestUpdate which creates a new unfulfilled Promise
        btnNode.kind = 'secondary';

        // Check if updateComplete resolves within 100ms or deadlocks
        const timeoutPromise = new Promise((resolve) => setTimeout(() => resolve('timed-out'), 100));
        const raceResult = await Promise.race([btnNode.updateComplete.then(() => 'resolved'), timeoutPromise]);

        root.unmount();
        container.remove();

        return {
          initialComplete,
          deadlocked: raceResult === 'timed-out',
        };
      });

      // Initial mount resolved
      expect(updateResult.initialComplete).toBe(true);
      // Property update commits properly and does not deadlock
      expect(updateResult.deadlocked).toBe(false);
    });

    it('documents CdsButton event dropping bug: onClick and onCdsButtonClick are destructured and discarded', async () => {
      const clickResult = await page.evaluate(() => {
        const container = document.createElement('div');
        document.body.appendChild(container);

        const React = (window as any).React;
        const StrictMode = (window as any).StrictMode;
        const CdsButton = (window as any).CdsButton;
        const createRoot = (window as any).createRoot;
        const createRef = (window as any).createRef;
        const flushSync = (window as any).flushSync;

        const buttonRef = createRef();
        const root = createRoot(container);

        let reactPropClickCount = 0;
        let nativeListenerClickCount = 0;

        const handlePropClick = () => {
          reactPropClickCount++;
        };

        flushSync(() => {
          root.render(React.createElement(StrictMode, null, React.createElement(CdsButton, { ref: buttonRef, onClick: handlePropClick, onCdsButtonClick: handlePropClick }, 'Click Test')));
        });

        const hostEl = buttonRef.current as HTMLElement;
        hostEl.addEventListener('click', () => {
          nativeListenerClickCount++;
        });

        const innerBtn = hostEl.querySelector('button') as HTMLButtonElement;
        innerBtn.click();

        root.unmount();
        container.remove();

        return {
          reactPropClickCount,
          nativeListenerClickCount,
        };
      });

      // Native click event bubbles up to hostEl
      expect(clickResult.nativeListenerClickCount).toBe(1);
      // React prop callbacks (onClick, onCdsButtonClick) are both delivered
      expect(clickResult.reactPropClickCount).toBe(2);
    });

    it('handles StrictMode remount without duplicate event listeners on CdsCheckbox', async () => {
      const remountResult = await page.evaluate(() => {
        const container = document.createElement('div');
        document.body.appendChild(container);

        const React = (window as any).React;
        const StrictMode = (window as any).StrictMode;
        const CdsCheckbox = (window as any).CdsCheckbox;
        const createRoot = (window as any).createRoot;
        const createRef = (window as any).createRef;
        const flushSync = (window as any).flushSync;

        const checkRef = createRef();
        const root = createRoot(container);

        let changeCount = 0;
        const handleChange = () => {
          changeCount++;
        };

        flushSync(() => {
          root.render(React.createElement(StrictMode, null, React.createElement(CdsCheckbox, { ref: checkRef, onCdsCheckboxChanged: handleChange, labelText: 'Remount Checkbox' })));
        });

        const hostEl = checkRef.current as HTMLElement;
        const inputEl = hostEl.querySelector('input') as HTMLInputElement;
        inputEl.click();

        root.unmount();
        container.remove();

        return {
          changeCount,
        };
      });

      // Exactly 1 change event received after StrictMode double-mount
      expect(remountResult.changeCount).toBe(1);
    });
  });
});
