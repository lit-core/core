import type React from 'react';
import { createContext, forwardRef, useContext, useLayoutEffect, useRef } from 'react';
import { MorphHost } from '../../runtime/morph-host.js';
import { useMorphHost } from '../../runtime/use-morph-host.js';

export interface TabsContextValue {
  activeValue: string;
  highlightedValue: string;
  vertical: boolean;
  type: string;
  size: string;
  dismissable: boolean;
  selectValue: (val: string, interaction?: string) => boolean;
}

export const TabsContext = createContext<TabsContextValue | null>(null);

export class CdsTabHost extends MorphHost {
  value = '';
  disabled = false;
  selected = false;
  highlighted = false;
  target?: string;
  secondaryLabel?: string;
  type?: string;
  vertical = false;
  iconOnly = false;
  iconSize?: string;
  badgeIndicator = false;
  tabTitle?: string;
  dismissable = false;

  static readonly _propertyDefaults = {
    value: '',
    disabled: false,
    selected: false,
    highlighted: false,
    target: undefined,
    secondaryLabel: undefined,
    type: undefined,
    vertical: false,
    iconOnly: false,
    iconSize: undefined,
    badgeIndicator: false,
    tabTitle: undefined,
    dismissable: false,
  };

  _linkNode: HTMLAnchorElement | null = null;

  override focus(options?: FocusOptions) {
    if (this._linkNode) {
      this._linkNode.focus(options);
    } else {
      super.focus(options);
    }
  }
}

export interface CdsTabProps extends React.HTMLAttributes<HTMLElement> {
  value: string;
  disabled?: boolean;
  selected?: boolean;
  highlighted?: boolean;
  target?: string;
  secondaryLabel?: string;
  type?: string;
  vertical?: boolean;
  iconOnly?: boolean;
  iconSize?: string;
  badgeIndicator?: boolean;
  tabTitle?: string;
  dismissable?: boolean;
  onCdsTabBeingclosed?: (event: CustomEvent<{ index: number }>) => void;
  onCdsTabClosed?: (event: CustomEvent<{ index: number }>) => void;
  children?: React.ReactNode;
}

export const CdsTab = forwardRef<HTMLElement, CdsTabProps>(function CdsTab(props, forwardedRef) {
  const {
    value,
    disabled = false,
    selected: controlledSelected,
    highlighted: controlledHighlighted,
    target,
    secondaryLabel,
    type,
    vertical: propVertical,
    iconOnly = false,
    iconSize,
    badgeIndicator = false,
    tabTitle,
    dismissable: propDismissable,
    onCdsTabBeingclosed,
    onCdsTabClosed,
    children,
    className = '',
    ...rest
  } = props;

  const context = useContext(TabsContext);
  const hostRef = useRef<HTMLElement | null>(null);
  const linkRef = useRef<HTMLAnchorElement | null>(null);

  const { host, elementRef } = useMorphHost(CdsTabHost, props, forwardedRef);

  // Determine effective state from props or context
  const isSelected = controlledSelected !== undefined ? controlledSelected : context ? context.activeValue === value : host.selected;

  const isHighlighted = controlledHighlighted !== undefined ? controlledHighlighted : context ? context.highlightedValue === value : host.highlighted;

  const isVertical = propVertical ?? context?.vertical ?? host.vertical ?? false;
  const isDismissable = propDismissable ?? context?.dismissable ?? host.dismissable ?? false;

  // Synchronize target panel visibility
  useLayoutEffect(() => {
    if (target) {
      const panel = document.getElementById(target);
      if (panel) {
        if (isSelected) {
          panel.removeAttribute('hidden');
        } else {
          panel.setAttribute('hidden', '');
        }
      }
    }
  }, [isSelected, target]);

  // Host element facade
  useLayoutEffect(() => {
    const el = hostRef.current;
    if (!el) return;

    if (isSelected) el.setAttribute('selected', '');
    else el.removeAttribute('selected');

    if (isHighlighted) el.setAttribute('highlighted', '');
    else el.removeAttribute('highlighted');

    if (disabled) el.setAttribute('disabled', '');
    else el.removeAttribute('disabled');

    if (isVertical) el.setAttribute('vertical', '');
    else el.removeAttribute('vertical');

    Object.defineProperties(el, {
      value: { get: () => value, configurable: true },
      selected: {
        get: () => isSelected,
        set: (v: boolean) => {
          if (v && context) {
            context.selectValue(value);
          }
        },
        configurable: true,
      },
      highlighted: { get: () => isHighlighted, configurable: true },
      disabled: { get: () => disabled, configurable: true },
      target: { get: () => target, configurable: true },
      focus: {
        value: (options?: FocusOptions) => {
          linkRef.current?.focus(options);
        },
        configurable: true,
        writable: true,
      },
    });
  }, [isSelected, isHighlighted, disabled, value, isVertical, target, context]);

  const navLinkClasses = ['cds--tabs__nav-link', isDismissable ? 'cds--tabs__nav-link--dismissable' : ''].filter(Boolean).join(' ');

  const accessibleLabel = tabTitle || (typeof children === 'string' ? children.trim() : undefined);

  return (
    <cds-tab
      ref={(node: HTMLElement | null) => {
        hostRef.current = node;
        host._attachHostElement(node);
        elementRef(node);
      }}
      role="listitem"
      value={value}
      selected={isSelected ? '' : undefined}
      disabled={disabled ? '' : undefined}
      highlighted={isHighlighted ? '' : undefined}
      vertical={isVertical ? '' : undefined}
      className={className}
      {...rest}
    >
      {/* biome-ignore lint/a11y/useValidAnchor: Carbon tabs render tab link without href per WAI-ARIA APG */}
      <a
        ref={(node) => {
          linkRef.current = node;
          host._linkNode = node;
        }}
        className={navLinkClasses}
        role="tab"
        aria-label={accessibleLabel}
        tabIndex={isSelected ? 0 : -1}
        aria-selected={isSelected ? 'true' : 'false'}
        data-disabled={disabled ? 'true' : undefined}
      >
        <span className="cds--tabs__nav-item-label-wrapper">{children}</span>
        {secondaryLabel && (
          <span className="cds--tabs__nav-item-secondary-label" title={secondaryLabel}>
            {secondaryLabel}
          </span>
        )}
        {!disabled && badgeIndicator && <cds-badge-indicator />}
      </a>
      {isDismissable && (
        <button
          type="button"
          className="cds--tabs__nav-item--close"
          title={tabTitle ? `Remove ${tabTitle} tab` : 'Remove tab'}
          tabIndex={-1}
          aria-hidden={isSelected ? 'false' : 'true'}
          disabled={disabled}
          onClick={(e) => {
            e.stopPropagation();
            const hostEl = hostRef.current;
            if (!hostEl) return;
            const init = { bubbles: true, cancelable: true, composed: true, detail: { index: 0 } };
            const beforeEvt = new CustomEvent('cds-tab-beingclosed', init);
            if (hostEl.dispatchEvent(beforeEvt)) {
              const closedEvt = new CustomEvent('cds-tab-closed', init);
              hostEl.dispatchEvent(closedEvt);
              onCdsTabClosed?.(closedEvt);
            }
          }}
        >
          <svg focusable="false" aria-label="close" viewBox="0 0 16 16" width="16" height="16">
            <path d="M12 4.7L11.3 4 8 7.3 4.7 4 4 4.7 7.3 8 4 11.3 4.7 12 8 8.7 11.3 12 12 11.3 8.7 8z" />
          </svg>
        </button>
      )}
    </cds-tab>
  );
});
