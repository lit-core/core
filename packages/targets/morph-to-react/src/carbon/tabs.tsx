import tabsStylesRaw from '@carbon/web-components/es/components/tabs/tabs.scss.js';
import type React from 'react';
import { forwardRef, useCallback, useLayoutEffect, useRef, useState } from 'react';
import { transformHostCss } from '../../runtime/css.js';
import { MorphHost } from '../../runtime/morph-host.js';
import { useMorphHost } from '../../runtime/use-morph-host.js';
import { TabsContext, type TabsContextValue } from './tab.js';

export const tabsStyles = transformHostCss((tabsStylesRaw as any).cssText, 'cds-tabs').replace(/::slotted\(([^)]+)\)/g, 'slot-boundary > $1');

export const tabsStylesHref = 'carbon-cds-tabs';

export class CdsTabsHost extends MorphHost {
  value = '';
  selectedIndex = 0;
  selectionMode: 'automatic' | 'manual' = 'automatic';
  type: 'default' | 'container' | 'contained' = 'default';
  vertical = false;
  dismissable = false;
  size: 'sm' | 'md' | 'lg' = 'md';
  iconSize?: string;
  fullWidth = false;

  static readonly _propertyDefaults = {
    value: '',
    selectedIndex: 0,
    selectionMode: 'automatic',
    type: 'default',
    vertical: false,
    dismissable: false,
    size: 'md',
    iconSize: undefined,
    fullWidth: false,
  };
}

export interface CdsTabsProps extends React.HTMLAttributes<HTMLElement> {
  value?: string;
  defaultValue?: string;
  selectedIndex?: number;
  selectionMode?: 'automatic' | 'manual';
  type?: 'default' | 'container' | 'contained';
  vertical?: boolean;
  dismissable?: boolean;
  size?: 'sm' | 'md' | 'lg';
  iconSize?: string;
  fullWidth?: boolean;
  selectingItemsAssistiveText?: string;
  selectedItemAssistiveText?: string;
  onCdsTabsBeingselected?: (event: CustomEvent<{ item: HTMLElement }>) => void;
  onCdsTabsSelected?: (event: CustomEvent<{ item: HTMLElement; index: number; name?: string; text?: string }>) => void;
  children?: React.ReactNode;
}

export const CdsTabs = forwardRef<HTMLElement, CdsTabsProps>(function CdsTabs(props, forwardedRef) {
  const {
    value: controlledValue,
    defaultValue,
    selectedIndex = 0,
    selectionMode = 'automatic',
    type = 'default',
    vertical = false,
    dismissable = false,
    size = 'md',
    iconSize,
    fullWidth = false,
    selectingItemsAssistiveText = 'Selecting items. Use up and down arrow keys to navigate.',
    selectedItemAssistiveText = 'Selected an item.',
    onCdsTabsBeingselected,
    onCdsTabsSelected,
    children,
    className = '',
    ...rest
  } = props;

  const hostRef = useRef<HTMLElement | null>(null);
  const boundaryRef = useRef<HTMLElement | null>(null);

  const [internalValue, setInternalValue] = useState<string>(controlledValue ?? defaultValue ?? '');
  const [highlightedValue, setHighlightedValue] = useState<string>('');
  const [assistiveText, setAssistiveText] = useState<string>('');

  const { host, elementRef } = useMorphHost(CdsTabsHost, props, forwardedRef);

  const prevControlledValue = useRef(controlledValue);
  useLayoutEffect(() => {
    if (controlledValue !== undefined && controlledValue !== prevControlledValue.current) {
      prevControlledValue.current = controlledValue;
      setInternalValue(controlledValue);
    }
  }, [controlledValue]);

  const activeValue = controlledValue !== undefined ? controlledValue : internalValue;

  const selectValue = useCallback(
    (targetVal: string, _interaction = 'mouse'): boolean => {
      const hostEl = hostRef.current;
      if (!hostEl) return false;

      const targetTab = hostEl.querySelector(`cds-tab[value="${targetVal}"]`) as HTMLElement | null;
      if (!targetTab || targetTab.hasAttribute('disabled')) return false;

      const beforeSelect = new CustomEvent('cds-tabs-beingselected', {
        bubbles: true,
        cancelable: true,
        composed: true,
        detail: { item: targetTab },
      });

      const allowed = host.dispatchEvent(beforeSelect);

      if (!allowed || beforeSelect.defaultPrevented) {
        return false;
      }

      setInternalValue(targetVal);
      setHighlightedValue('');
      setAssistiveText(selectedItemAssistiveText);

      if (typeof (targetTab as any).focus === 'function') {
        (targetTab as any).focus();
      }

      const allTabs = Array.from(hostEl.querySelectorAll('cds-tab'));
      const index = allTabs.indexOf(targetTab);
      const name = targetTab.getAttribute('name') || undefined;
      const text = targetTab.textContent?.trim() || targetTab.getAttribute('aria-label') || undefined;

      const afterSelect = new CustomEvent('cds-tabs-selected', {
        bubbles: true,
        composed: true,
        detail: { item: targetTab, index, name, text },
      });

      host.dispatchEvent(afterSelect);
      return true;
    },
    [host, selectedItemAssistiveText],
  );

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLElement>) => {
      const target = e.target as HTMLElement;
      const tab = target.closest('cds-tab') as HTMLElement | null;
      if (!tab || tab.hasAttribute('disabled')) return;
      const tabVal = tab.getAttribute('value');
      if (tabVal && tabVal !== activeValue) {
        selectValue(tabVal, 'mouse');
      }
    },
    [activeValue, selectValue],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLElement>) => {
      const hostEl = hostRef.current;
      if (!hostEl) return;

      const enabledTabs = Array.from(hostEl.querySelectorAll('cds-tab:not([disabled])')) as HTMLElement[];
      if (enabledTabs.length === 0) return;

      const focusedTab = document.activeElement?.closest('cds-tab') as HTMLElement | null;
      const currentTab =
        (focusedTab && enabledTabs.includes(focusedTab) ? focusedTab : null) ||
        (hostEl.querySelector('cds-tab[highlighted]') as HTMLElement | null) ||
        (hostEl.querySelector('cds-tab[selected]') as HTMLElement | null) ||
        enabledTabs[0];
      const currentIndex = enabledTabs.indexOf(currentTab);

      let nextIndex = -1;
      const key = e.key;

      const isForward = vertical ? key === 'ArrowDown' || key === 'Down' : key === 'ArrowRight' || key === 'Right';

      const isBackward = vertical ? key === 'ArrowUp' || key === 'Up' : key === 'ArrowLeft' || key === 'Left';

      if (isForward) {
        e.preventDefault();
        nextIndex = (currentIndex + 1) % enabledTabs.length;
      } else if (isBackward) {
        e.preventDefault();
        nextIndex = (currentIndex - 1 + enabledTabs.length) % enabledTabs.length;
      } else if (key === 'Home') {
        e.preventDefault();
        nextIndex = 0;
      } else if (key === 'End') {
        e.preventDefault();
        nextIndex = enabledTabs.length - 1;
      }

      if (nextIndex >= 0) {
        const nextTab = enabledTabs[nextIndex];
        const nextVal = nextTab.getAttribute('value');
        if (nextVal) {
          if (selectionMode === 'automatic') {
            selectValue(nextVal, 'keyboard');
          } else {
            setHighlightedValue(nextVal);
            if (typeof (nextTab as any).focus === 'function') {
              (nextTab as any).focus();
            }
          }
        }
      } else if (selectionMode === 'manual' && (key === 'Enter' || key === ' ') && highlightedValue) {
        e.preventDefault();
        selectValue(highlightedValue, 'activation');
      }
    },
    [vertical, selectionMode, highlightedValue, selectValue],
  );

  // MutationObserver for child tab sizing custom properties
  useLayoutEffect(() => {
    const boundary = boundaryRef.current;
    const hostEl = hostRef.current;
    if (!boundary || !hostEl) return;

    const syncTokens = () => {
      const tabs = hostEl.querySelectorAll('cds-tab');
      tabs.forEach((tab) => {
        if (size && tab instanceof HTMLElement) {
          tab.style.setProperty('--cds-layout-size-height', `var(--cds-layout-size-height-${size})`);
        }
      });
    };

    syncTokens();

    const observer = new MutationObserver(() => {
      syncTokens();
    });

    observer.observe(boundary, { childList: true });
    return () => observer.disconnect();
  }, [size]);

  // Host element facade
  useLayoutEffect(() => {
    const el = hostRef.current;
    if (!el) return;

    Object.defineProperties(el, {
      value: { get: () => activeValue, configurable: true },
      selectedIndex: { get: () => selectedIndex, configurable: true },
      resetSelected: {
        value: (tabEl: HTMLElement) => {
          const val = tabEl.getAttribute('value');
          if (val) selectValue(val);
        },
        configurable: true,
      },
    });
  }, [activeValue, selectedIndex, selectValue]);

  const contextValue: TabsContextValue = {
    activeValue,
    highlightedValue,
    vertical,
    type,
    size,
    dismissable,
    selectValue,
  };

  return (
    <TabsContext.Provider value={contextValue}>
      <style href={tabsStylesHref} precedence="default">
        {tabsStyles}
      </style>
      <cds-tabs
        ref={(node: HTMLElement | null) => {
          hostRef.current = node;
          host._attachHostElement(node);
          elementRef(node);
        }}
        value={activeValue || undefined}
        className={className}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        {...rest}
      >
        <div className="cds--tabs-nav-content-container">
          <div className="cds--tabs-nav-content">
            <div className="cds--tabs-nav">
              <div id="tablist" role="tablist" className="cds--tab--list">
                <div className="cds--sub-content-left" />
                <slot-boundary ref={boundaryRef} style={{ display: 'contents' }}>
                  {children}
                </slot-boundary>
                <div className="cds--sub-content-right" />
              </div>
            </div>
          </div>
        </div>
        <div className="cds--assistive-text" role="status" aria-live="assertive" aria-relevant="additions text">
          {assistiveText}
        </div>
      </cds-tabs>
    </TabsContext.Provider>
  );
});
